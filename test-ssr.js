import { renderToString } from "react-dom/server";
import React from "react";
import MonacoEditor from "@monaco-editor/react";

const Component = typeof MonacoEditor === 'object' && MonacoEditor.default ? MonacoEditor.default : MonacoEditor;

try {
  const el = React.createElement(Component);
  renderToString(el);
  console.log("SSR successful");
} catch (e) {
  console.error("SSR failed", e);
}
