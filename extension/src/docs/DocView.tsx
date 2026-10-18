import type { ReactElement } from 'react';
import type { Block, Doc, ListItem } from './doc';

type Tree = { text: string; children: Tree[] };

/** Turns flat items with levels into nested lists, so screen readers hear the structure. */
export function nestItems(items: ListItem[]): Tree[] {
  const roots: Tree[] = [];
  const stack: { level: number; node: Tree }[] = [];
  for (const item of items) {
    const node: Tree = { text: item.text, children: [] };
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= item.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.node.children.push(node);
    else roots.push(node);
    stack.push({ level: item.level, node });
  }
  return roots;
}

function List({ items }: { items: Tree[] }): ReactElement {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>
          {item.text}
          {item.children.length > 0 && <List items={item.children} />}
        </li>
      ))}
    </ul>
  );
}

function BlockView({ block }: { block: Block }): ReactElement {
  switch (block.kind) {
    case 'heading':
      return <h3>{block.text}</h3>;
    case 'paragraph':
      return <p>{block.text}</p>;
    case 'list':
      return <List items={nestItems(block.items)} />;
    case 'table': {
      const [head, ...rows] = block.rows;
      return (
        <div className="rw-table-wrap">
          <table>
            {head && (
              <thead>
                <tr>
                  {head.map((cell, i) => (
                    <th key={i} scope="col">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'notes':
      return (
        <details className="rw-notes">
          <summary>Speaker notes</summary>
          {block.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </details>
      );
  }
}

/** The readable document: one labelled section per slide or page. */
export function DocView({ doc }: { doc: Doc }): ReactElement {
  return (
    <>
      <h1 className="rw-doc-title">{doc.name}</h1>
      {doc.sections.map((section, i) => {
        const id = `rw-section-${i}`;
        return (
          <section key={i} className="rw-doc-section" aria-labelledby={id}>
            <h2 id={id}>
              <span className="rw-section-label">{section.label}</span>
              {section.title && <span className="rw-section-title">{section.title}</span>}
            </h2>
            {section.blocks.length === 0 ? (
              <p className="rw-empty-section">No text on this {doc.kind === 'pptx' ? 'slide' : 'page'}.</p>
            ) : (
              section.blocks.map((block, b) => <BlockView key={b} block={block} />)
            )}
          </section>
        );
      })}
    </>
  );
}
