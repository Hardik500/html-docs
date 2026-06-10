import { useEffect } from "react";
import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";

interface DocEditorProps {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
}

function ToolbarButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      // onMouseDown+preventDefault keeps focus in the editor while clicking.
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`px-2 py-1 rounded text-xs font-semibold transition-colors disabled:opacity-30 ${
        active ? "bg-primary/15 text-primary" : "text-muted hover:bg-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: TiptapEditor }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 px-3 py-1.5 border-b border-hairline bg-surface shrink-0">
      <ToolbarButton title="Bold" active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolbarButton>
      <ToolbarButton title="Underline" active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarButton>
      <ToolbarButton title="Strikethrough" active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></ToolbarButton>
      <span className="w-px h-4 bg-hairline mx-1" />
      {([1, 2, 3] as const).map((level) => (
        <ToolbarButton key={level} title={`Heading ${level}`} active={editor.isActive("heading", { level })}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}>H{level}</ToolbarButton>
      ))}
      <span className="w-px h-4 bg-hairline mx-1" />
      <ToolbarButton title="Bullet list" active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}>•≡</ToolbarButton>
      <ToolbarButton title="Numbered list" active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}>1≡</ToolbarButton>
      <ToolbarButton title="Blockquote" active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}>&ldquo;&rdquo;</ToolbarButton>
      <ToolbarButton title="Link" active={editor.isActive("link")}
        onClick={() => {
          if (editor.isActive("link")) { editor.chain().focus().unsetLink().run(); return; }
          const url = window.prompt("Link URL");
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}>🔗</ToolbarButton>
      <span className="w-px h-4 bg-hairline mx-1" />
      <ToolbarButton title="Undo" disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}>↶</ToolbarButton>
      <ToolbarButton title="Redo" disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}>↷</ToolbarButton>
    </div>
  );
}

export default function DocEditor({ value, onChange, onBlur }: DocEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, Image, TableKit.configure({ table: { resizable: false } })],
    content: value,
    // React Router SSRs this route; TipTap must not render on the server.
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    onBlur: () => onBlur?.(),
  });

  // Sync external value changes (tab switch). After a normal edit the parent
  // echoes back exactly what getHTML() produced, so this is a no-op then.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  return (
    <div className="doc-editor flex flex-col h-full bg-canvas">
      {editor && <Toolbar editor={editor} />}
      <div className="flex-1 overflow-y-auto" onClick={() => editor?.chain().focus().run()}>
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
