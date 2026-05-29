'use client';

// build 205 #8: 상품 설명 WYSIWYG 에디터 (TipTap). 카페24 에디봇 컨셉 — 본문 + 이미지 임베드.
// 이미지는 supabase storage `product-images` 버킷에 업로드 후 src 로 삽입.

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { useRef } from 'react';
import { Bold, Italic, Heading2, List, ListOrdered, ImagePlus, Link2, Quote, Undo2, Redo2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export default function RichTextEditor({ value, onChange, placeholder }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { tt } = useI18n();

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, HTMLAttributes: { class: 'rounded-xl my-3 max-w-full' } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: 'text-emerald-600 underline' } }),
    ],
    content: value || '<p></p>',
    onUpdate({ editor }) { onChange(editor.getHTML()); },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[200px] px-3 py-3 focus:outline-none dark:prose-invert',
      },
    },
    immediatelyRender: false,
  });

  if (!editor) return <div className="h-64 rounded-xl bg-[var(--card-border)]/30 animate-pulse" />;

  const uploadImage = async (file: File) => {
    const sb = getSupabase();
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `editor/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from('product-images').upload(path, file, { upsert: false, contentType: file.type });
    if (error) { alert(tt('이미지 업로드 실패') + ': ' + error.message); return; }
    const { data } = sb.storage.from('product-images').getPublicUrl(path);
    editor.chain().focus().setImage({ src: data.publicUrl }).run();
  };

  const Btn = ({ active, onClick, children, label }: { active?: boolean; onClick: () => void; children: React.ReactNode; label: string }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition active:scale-90 ${
        active ? 'bg-emerald-500 text-white' : 'text-[var(--muted)] hover:bg-[var(--card-border)]/40'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--background)] overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 py-2 border-b border-[var(--card-border)] bg-[var(--card)] flex-wrap">
        <Btn label="H2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 size={16} />
        </Btn>
        <Btn label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </Btn>
        <Btn label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </Btn>
        <Btn label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote size={16} />
        </Btn>
        <Btn label="UL" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={16} />
        </Btn>
        <Btn label="OL" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={16} />
        </Btn>
        <Btn label="Link" active={editor.isActive('link')} onClick={() => {
          const url = window.prompt(tt('링크 주소'), editor.getAttributes('link').href ?? 'https://');
          if (url === null) return;
          if (url === '') { editor.chain().focus().unsetLink().run(); return; }
          editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }}>
          <Link2 size={16} />
        </Btn>
        <Btn label="Image" onClick={() => fileRef.current?.click()}>
          <ImagePlus size={16} />
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) uploadImage(f);
            e.target.value = '';
          }}
        />
        <div className="flex-1" />
        <Btn label="Undo" onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={16} />
        </Btn>
        <Btn label="Redo" onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={16} />
        </Btn>
      </div>
      <EditorContent editor={editor} placeholder={placeholder} />
    </div>
  );
}
