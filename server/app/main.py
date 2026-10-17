import logging
import threading
import time
from collections.abc import Awaitable, Callable

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.cache import ResponseCache
from app.config import get_settings
from app.llm.base import LLMOutputError, LLMProviderError
from app.llm.factory import ProviderConfigError, make_provider
from app.logging_utils import logger
from app.pipeline import SimplifyService
from app.ratelimit import RateLimiter
from app.schemas import SimplifyRequest, SimplifyResponse


def _configure_logging() -> None:
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)


def create_app(
    service: SimplifyService | None = None,
    limiter: RateLimiter | None = None,
) -> FastAPI:
    _configure_logging()
    app = FastAPI(title="Readwell server")
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"chrome-extension://.*",
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    rate_limiter = limiter or RateLimiter(limit=30, window_s=60)
    service_lock = threading.Lock()
    service_holder: list[SimplifyService] = [service] if service else []

    def get_service() -> SimplifyService:
        # Built lazily so the app (and /health) start even without an API key.
        with service_lock:
            if not service_holder:
                settings = get_settings()
                model = settings.llm_model or settings.llm_provider
                service_holder.append(
                    SimplifyService(
                        make_provider(settings), ResponseCache(settings.cache_path), model
                    )
                )
            return service_holder[0]

    def rate_limit(request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        if not rate_limiter.allow(ip):
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please wait a minute and try again.",
                headers={"Retry-After": str(int(rate_limiter.window_s))},
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

    @app.post("/simplify", dependencies=[Depends(rate_limit)])
    def simplify(body: SimplifyRequest) -> SimplifyResponse:
        try:
            return get_service().simplify(body.text, body.level)
        except ProviderConfigError as exc:
            logger.error("provider not configured")
            raise HTTPException(status_code=503, detail=str(exc)) from None
        except LLMOutputError:
            raise HTTPException(
                status_code=502,
                detail="The AI returned an invalid response twice. Please try again.",
            ) from None
        except LLMProviderError as exc:
            logger.warning("llm provider error: %s", exc)
            raise HTTPException(
                status_code=502,
                detail="The AI service is busy or out of quota right now. Please try again later.",
            ) from None

    return app


app = create_app()
