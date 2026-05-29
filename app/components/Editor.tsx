import MonacoEditor from "@monaco-editor/react";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

export default function Editor({ value, onChange, onBlur }: EditorProps) {
  return (
    <MonacoEditor
      height="100%"
      language="html"
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
      onChange={(val) => onChange(val ?? "")}
      onMount={(editor) => {
        editor.onDidBlurEditorText(() => {
          onBlur?.();
        });
      }}
    />
  );
}
