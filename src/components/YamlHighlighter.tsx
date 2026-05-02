import { useRef, useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('yaml', yaml);

const OPENSHIFT_YAML_STYLES = `
.yaml-highlight {
  font-family: var(--pf-t--global--font--family--mono, "Red Hat Mono", "Liberation Mono", monospace);
  font-size: 0.875rem;
  line-height: 1.6;
  background: var(--pf-t--global--background--color--primary--default, #fff);
  color: var(--pf-t--global--text--color--regular, #151515);
  padding: 1rem;
  overflow-x: auto;
  border: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
  border-radius: var(--pf-t--global--border--radius--small, 3px);
  white-space: pre;
  tab-size: 2;
  margin: 0;
}
.yaml-highlight .hljs-attr { color: #795600; }
.yaml-highlight .hljs-string { color: var(--pf-t--global--color--brand--default, #0066cc); }
.yaml-highlight .hljs-number { color: var(--pf-t--global--color--brand--default, #0066cc); }
.yaml-highlight .hljs-literal { color: var(--pf-t--global--color--brand--default, #0066cc); }
.yaml-highlight .hljs-bullet { color: var(--pf-t--global--text--color--regular, #151515); }
.yaml-highlight .hljs-meta { color: var(--pf-t--global--text--color--subtle, #6a6a6a); }
.yaml-highlight .hljs-comment { color: var(--pf-t--global--text--color--subtle, #6a6a6a); font-style: italic; }

.pf-v6-theme-dark .yaml-highlight .hljs-attr { color: #e5a00d; }

.yaml-editor-wrapper {
  position: relative;
}
.yaml-editor-wrapper .yaml-highlight {
  pointer-events: none;
}
.yaml-editor-wrapper textarea {
  position: absolute;
  inset: 0;
  font-family: var(--pf-t--global--font--family--mono, "Red Hat Mono", "Liberation Mono", monospace);
  font-size: 0.875rem;
  line-height: 1.6;
  padding: 1rem;
  margin: 0;
  border: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
  border-radius: var(--pf-t--global--border--radius--small, 3px);
  color: transparent;
  caret-color: var(--pf-t--global--text--color--regular, #151515);
  background: transparent;
  white-space: pre;
  tab-size: 2;
  resize: none;
  overflow: auto;
  outline: none;
}
.yaml-editor-wrapper textarea:focus {
  border-color: var(--pf-t--global--color--brand--default, #0066cc);
  box-shadow: 0 0 0 1px var(--pf-t--global--color--brand--default, #0066cc);
}
.yaml-editor-wrapper textarea::selection {
  background: rgba(0, 102, 204, 0.2);
}
.pf-v6-theme-dark .yaml-editor-wrapper textarea::selection {
  background: rgba(115, 188, 247, 0.3);
}
`;

function highlightYaml(code: string): string {
  const html = hljs.highlight(code, { language: 'yaml' }).value;
  return html.replace(
    /(?<![<\w])(\[\]|\{\})/g,
    '<span class="hljs-literal">$1</span>',
  );
}

interface YamlHighlighterProps {
  code: string;
  id?: string;
  editable?: boolean;
  onChange?: (value: string) => void;
  minHeight?: string;
}

const YamlHighlighter: React.FC<YamlHighlighterProps> = ({
  code,
  id,
  editable = false,
  onChange,
  minHeight = '400px',
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const highlighted = useMemo(() => highlightYaml(code), [code]);

  const handleScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = `${code.substring(0, start)}  ${code.substring(end)}`;
      onChange?.(newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  if (editable) {
    return (
      <>
        <style>{OPENSHIFT_YAML_STYLES}</style>
        <div className="yaml-editor-wrapper" style={{ minHeight }}>
          <pre
            ref={preRef}
            className="yaml-highlight"
            style={{ minHeight, overflow: 'auto' }}
            aria-hidden="true"
          >
            <code dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }} />
          </pre>
          <textarea
            ref={textareaRef}
            id={id}
            value={code}
            onChange={(e) => onChange?.(e.target.value)}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            aria-label="YAML configuration editor"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
        </div>
      </>
    );
  }

  return (
    <>
      <style>{OPENSHIFT_YAML_STYLES}</style>
      <pre className="yaml-highlight">
        <code id={id} dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </>
  );
};

export default YamlHighlighter;
