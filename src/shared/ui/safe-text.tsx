'use client';
export function SafeText({ text }: { text: string }) {
  const pieces = text.split(/(https?:\/\/[^\s<>]+)/g);
  return (
    <>
      {pieces.map((piece, index) => {
        let url: URL | null = null;
        try {
          if (/^https?:\/\//.test(piece)) url = new URL(piece);
        } catch {}
        return url &&
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password ? (
          <a
            key={index}
            href={url.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {piece}
          </a>
        ) : (
          <span key={index}>{piece}</span>
        );
      })}
    </>
  );
}
