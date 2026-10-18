import logging
import threading
import time
from collections.abc import Awaitable, Callable

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

from app.budget import DailyBudget
from app.cache import ResponseCache
from app.config import Settings, get_settings
from app.http_limits import BodySizeLimit
from app.llm.base import DailyLimitError, LLMOutputError, LLMProviderError
from app.llm.factory import ProviderConfigError, make_provider
from app.logging_utils import logger
from app.meaning.check import CheckService, NotSimplifiedError
from app.pipeline import SimplifyService
from app.privacy import render_privacy
from app.ratelimit import RateLimiter
from app.schemas import CheckResponse, SimplifyRequest, SimplifyResponse


def _configure_logging() -> None:
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)


DAILY_LIMIT_MESSAGE = "Readwell has reached its daily limit. Please try again tomorrow."
IP_DAY_MESSAGE = "You've reached today's limit for this connection. Please try again tomorrow."
DAY_S = 24 * 60 * 60


def create_app(
    service: SimplifyService | None = None,
    limiter: RateLimiter | None = None,
    check_service: CheckService | None = None,
    settings: Settings | None = None,
    day_limiter: RateLimiter | None = None,
) -> FastAPI:
    _configure_logging()
    config = settings or get_settings()
    production = config.is_production
    # API docs are for development only.
    app = FastAPI(
        title="Readwell server",
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
    )
    if production:
        # Only the Readwell extension(s) configured here may call the API from a browser.
        origins = [f"chrome-extension://{ext_id}" for ext_id in config.extension_ids]
        if not origins:
            logger.warning(
                "APP_ENV=production but ALLOWED_EXTENSION_IDS is empty: no browser origin allowed"
            )
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type"],
        )
    else:
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"chrome-extension://.*",
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type"],
        )
    app.add_middleware(BodySizeLimit)  # outermost: rejects oversized bodies before anything else
    rate_limiter = limiter or RateLimiter(limit=config.per_minute, window_s=60)
    daily_limiter = day_limiter or (
        RateLimiter(limit=config.per_day, window_s=DAY_S) if config.per_day else None
    )
    if (service is None) != (check_service is None):
        raise ValueError("pass both service and check_service, or neither")
    service_lock = threading.Lock()
    service_holder: list[tuple[SimplifyService, CheckService]] = []
    if service is not None and check_service is not None:
        service_holder.append((service, check_service))

    def get_services() -> tuple[SimplifyService, CheckService]:
        # Built lazily so the app (and /health) start even without an API key.
        with service_lock:
            if not service_holder:
                limit = config.ai_calls_per_day
                provider = make_provider(config, DailyBudget(limit) if limit else None)
                model = config.llm_model or config.llm_provider
                ttl = config.cache_ttl_hours
                simplifier = SimplifyService(
                    provider, ResponseCache(config.cache_path, ttl_hours=ttl), model
                )
                checker = CheckService(
                    simplifier,
                    provider,
                    ResponseCache(config.cache_path, table="check_cache", ttl_hours=ttl),
                    config.meaning_check,
                    repair=config.meaning_repair == "on",
                )
                service_holder.append((simplifier, checker))
            return service_holder[0]

    def rate_limit(request: Request) -> None:
        # Behind Render's proxy, uvicorn --proxy-headers puts the visitor's IP here.
        ip = request.client.host if request.client else "unknown"
        if not rate_limiter.allow(ip):
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please wait a minute and try again.",
                headers={"Retry-After": str(int(rate_limiter.window_s))},
            )
        if daily_limiter is not None and not daily_limiter.allow(ip):
            raise HTTPException(
                status_code=429,
                detail=IP_DAY_MESSAGE,
                headers={"Retry-After": "3600"},
            )

    @app.middleware("http")
    async def log_requests(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.perf_counter()
        response = await call_next(request)
        # Method, path and status only: never bodies or query strings.
        logger.info(
            "%s %s %d %dms",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - started) * 1000,
        )
        return response

    @app.exception_handler(RequestValidationError)
    async def bad_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Drop the "input" field Pydantic adds: it would echo the user's text back.
        errors = [{"loc": list(e.get("loc", [])), "msg": e.get("msg", "")} for e in exc.errors()]
        return JSONResponse(status_code=400, content={"detail": errors})

    @app.exception_handler(Exception)
    async def unexpected(_: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled error type=%s", type(exc).__name__)
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    privacy_page = render_privacy(config.privacy_contact, config.cache_ttl_hours)

    @app.get("/privacy", response_class=HTMLResponse)
    def privacy() -> str:
        return privacy_page

    @app.post("/simplify", dependencies=[Depends(rate_limit)])
    def simplify(body: SimplifyRequest) -> SimplifyResponse:
        try:
            return get_services()[0].simplify(body.text, body.level)
        except ProviderConfigError as exc:
            logger.error("provider not configured")
            raise HTTPException(status_code=503, detail=str(exc)) from None
        except LLMOutputError:
            raise HTTPException(
                status_code=502,
                detail="The AI returned an invalid response twice. Please try again.",
            ) from None
        except DailyLimitError:
            raise HTTPException(status_code=503, detail=DAILY_LIMIT_MESSAGE) from None
        except LLMProviderError as exc:
            logger.warning("llm provider error: %s", exc)
            raise HTTPException(
                status_code=502,
                detail="The AI service is busy or out of quota right now. Please try again later.",
            ) from None

    @app.post("/check", dependencies=[Depends(rate_limit)])
    def check(body: SimplifyRequest) -> CheckResponse:
        try:
            checker = get_services()[1]
        except ProviderConfigError as exc:
            logger.error("provider not configured")
            raise HTTPException(status_code=503, detail=str(exc)) from None
        if checker.mode == "off":
            raise HTTPException(status_code=404, detail="The meaning check is turned off.")
        try:
            return checker.check(body.text, body.level)
        except NotSimplifiedError:
            raise HTTPException(status_code=409, detail="Simplify this text first.") from None

    return app


app = create_app()
