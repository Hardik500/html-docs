import { useState, useEffect } from "react";
import MonacoEditorRaw, { type OnChange, type OnMount } from "@monaco-editor/react";

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
