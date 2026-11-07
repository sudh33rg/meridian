import React, { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const COLORS = ["#3468e5", "#d9480f", "#2b8a3e", "#a61e4d", "#5f3dc4", "#0b7285", "#e67700"];
const colorFor = (s: string) => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const RESET_CLOSE_CODE = 4001; // server: the page was replaced (restore / REST save)

type Ctx = { doc: Y.Doc; provider: WebsocketProvider };

function Editor({ ctx, canEdit, userName }: { ctx: Ctx; canEdit: boolean; userName: string }) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: canEdit,
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: ctx.doc }),
        CollaborationCaret.configure({
          provider: ctx.provider,
          user: { name: userName, color: colorFor(userName) },
        }),
      ],
      editorProps: { attributes: { class: "prose-editor", "aria-label": "Page content" } },
    },
    [ctx, canEdit],
  );
  if (!editor) return null;
  const btn = (label: string, active: boolean, run: () => void) => (
    <button
      type="button"
      className={"tb" + (active ? " on" : "")}
      disabled={!canEdit}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );
  return (
    <>
      <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
        {btn("B", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run())}
        {btn("I", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run())}
        {btn("H2", editor.isActive("heading", { level: 2 }), () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
        )}
        {btn("• List", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run())}
        {btn("1. List", editor.isActive("orderedList"), () =>
          editor.chain().focus().toggleOrderedList().run(),
        )}
        {btn("Quote", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run())}
        {btn("Code", editor.isActive("codeBlock"), () => editor.chain().focus().toggleCodeBlock().run())}
      </div>
      <EditorContent editor={editor} />
    </>
  );
}

/** A live, multi-user editor for one page (Yjs over WebSocket; autosaves on the server). */
export function CollabEditor({
  pageId,
  canEdit,
  userName,
}: {
  pageId: string;
  canEdit: boolean;
  userName: string;
}) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [people, setPeople] = useState(1);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const doc = new Y.Doc();
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/collab`;
    const provider = new WebsocketProvider(url, pageId, doc);
    const onStatus = (e: { status: "connecting" | "connected" | "disconnected" }) => setStatus(e.status);
    const onClose = (e: CloseEvent | null) => {
      // The server reset the room: drop our copy and reload instead of merging stale state.
      if (e && e.code === RESET_CLOSE_CODE) setEpoch((n) => n + 1);
    };
    const onAwareness = () => setPeople(Math.max(1, provider.awareness.getStates().size));
    provider.on("status", onStatus);
    provider.on("connection-close", onClose);
    provider.awareness.on("change", onAwareness);
    setCtx({ doc, provider });
    return () => {
      provider.off("status", onStatus);
      provider.off("connection-close", onClose);
      provider.awareness.off("change", onAwareness);
      provider.destroy();
      doc.destroy();
      setCtx(null);
      setStatus("connecting");
    };
  }, [pageId, epoch]);

  return (
    <div className="collab">
      <div className="collab-status" role="status">
        <span className={"dot " + status} />
        {status === "connected"
          ? "Live"
          : status === "connecting"
            ? "Connecting…"
            : "Offline — changes will sync when you reconnect"}
        {status === "connected" && people > 1 ? ` · ${people} people here` : ""}
        {!canEdit && " · read only"}
      </div>
      {ctx ? <Editor key={`${pageId}:${epoch}`} ctx={ctx} canEdit={canEdit} userName={userName} /> : null}
    </div>
  );
}
