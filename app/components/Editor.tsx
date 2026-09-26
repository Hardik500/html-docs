import { useState, useEffect } from "react";
import MonacoEditorRaw, {
  loader,
  type OnChange,
  type OnMount,
} from "@monaco-editor/react";

// Serve the editor from our own origin. Without this, @monaco-editor/react's
// AMD loader pulls ~1 MB from cdn.jsdelivr.net across 14 cross-origin requests
// before the editor is usable, adding a third-party DNS + TLS handshake to the
// critical path of opening a document. The assets are copied from the installed
// monaco-editor package into public/monaco by scripts/copy-monaco.mjs
// (npm run prebuild / predev), so the version always matches the dependency.
//
// `loader` must be the instance @monaco-editor/react itself uses — it is
// re-exported from there for exactly this purpose. Importing it from
// "@monaco-editor/loader" directly resolves to the CommonJS build under SSR,
// where the default export is an object and `loader.config` is undefined.
loader.config({ paths: { vs: `${import.meta.env.BASE_URL}monaco/vs` } });

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  language?: string;
}

export default function Editor({ value, onChange, onBlur, language = "html" }: EditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-full w-full bg-[#1e1e1e]" />;
  }

  // Handle ESM/CJS interop for SSR environments
  // @ts-expect-error - Some environments expose the default export as an object property
  const MonacoEditor = (typeof MonacoEditorRaw === 'object' && MonacoEditorRaw.default) ? MonacoEditorRaw.default : MonacoEditorRaw;

  return (
    <MonacoEditor
      height="100%"
      language={language}
      theme="vs-dark"
      value={value}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: "on",
        wordWrap: "on",
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 2,
        insertSpaces: true,
        formatOnPaste: true,
      }}
      onChange={((val: string | undefined) => onChange(val ?? "")) as OnChange}
      onMount={((editor) => {
        editor.onDidBlurEditorText(() => {
          onBlur?.();
        });
      }) as OnMount}
    />
  );
}
