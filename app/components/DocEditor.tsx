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
  const inTable = editor.isActive("table");

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
          if (url) {
            const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
            editor.chain().focus().setLink({ href }).run();
          }
        }}>🔗</ToolbarButton>
      <span className="w-px h-4 bg-hairline mx-1" />

      {/* ── Table controls ───────────────────────────────────────────── */}
      {/* Insert table — only available when NOT already inside one */}
      <ToolbarButton
        title="Insert table"
        disabled={inTable}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
        </svg>
      </ToolbarButton>

      {/* Context-sensitive table editing — only shown when cursor is inside a table */}
      {inTable && (
        <>
          <span className="w-px h-4 bg-hairline mx-1" />

          {/* Row operations */}
          <ToolbarButton title="Insert row above"
            disabled={!editor.can().addRowBefore()}
            onClick={() => editor.chain().focus().addRowBefore().run()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="9" width="18" height="12" rx="1"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="9" y1="5" x2="15" y2="5"/>
            </svg>
          </ToolbarButton>
          <ToolbarButton title="Insert row below"
            disabled={!editor.can().addRowAfter()}
            onClick={() => editor.chain().focus().addRowAfter().run()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="12" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="9" y1="19" x2="15" y2="19"/>
            </svg>
          </ToolbarButton>
          <ToolbarButton title="Delete row"
            disabled={!editor.can().deleteRow()}
            onClick={() => editor.chain().focus().deleteRow().run()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/>
            </svg>
          </ToolbarButton>

          <span className="w-px h-4 bg-hairline mx-0.5" />

          {/* Column operations */}
          <ToolbarButton title="Insert column before"
            disabled={!editor.can().addColumnBefore()}
            onClick={() => editor.chain().focus().addColumnBefore().run()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="12" height="18" rx="1"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="5" y1="9" x2="5" y2="15"/>
            </svg>
          </ToolbarButton>
          <ToolbarButton title="Insert column after"
            disabled={!editor.can().addColumnAfter()}
            onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="12" height="18" rx="1"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="17" y1="12" x2="21" y2="12"/><line x1="19" y1="9" x2="19" y2="15"/>
            </svg>
          </ToolbarButton>
          <ToolbarButton title="Delete column"
            disabled={!editor.can().deleteColumn()}
            onClick={() => editor.chain().focus().deleteColumn().run()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="1"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="12" y1="9" x2="12" y2="15"/>
            </svg>
          </ToolbarButton>

          <span className="w-px h-4 bg-hairline mx-0.5" />

          {/* Merge / split */}
          <ToolbarButton title="Merge selected cells"
            disabled={!editor.can().mergeCells()}
            onClick={() => editor.chain().focus().mergeCells().run()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="21"/>
            </svg>
          </ToolbarButton>
          <ToolbarButton title="Split merged cell"
            disabled={!editor.can().splitCell()}
            onClick={() => editor.chain().focus().splitCell().run()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/>
            </svg>
          </ToolbarButton>

          <span className="w-px h-4 bg-hairline mx-0.5" />

          {/* Delete table */}
          <ToolbarButton title="Delete table"
            disabled={!editor.can().deleteTable()}
            onClick={() => editor.chain().focus().deleteTable().run()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
              <rect x="3" y="3" width="18" height="18" rx="1"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>
            </svg>
          </ToolbarButton>
        </>
      )}

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
    extensions: [StarterKit, Image, TableKit.configure({ table: { resizable: true } })],
    content: value,
    // React Router SSRs this route; TipTap must not render on the server.
    immediatelyRender: false,
    // In @tiptap/react v3, shouldRerenderOnTransaction defaults to false.
    // Without this flag, toolbar isActive() highlights and can().undo/redo
    // disabled states are frozen (stale) after each editor transaction.
    shouldRerenderOnTransaction: true,
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
