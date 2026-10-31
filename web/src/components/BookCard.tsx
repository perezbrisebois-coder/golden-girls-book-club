import type { BookInfo } from "../types";
import { authorList } from "../format";
import { BookPlaceholder } from "./Deco";

export function BookCard({ book, children }: { book: BookInfo; children?: React.ReactNode }) {
  return (
    <div className="book-card">
      {book.coverUrl ? (
        <img className="book-cover" src={book.coverUrl} alt={`Cover of ${book.title}`} loading="lazy" />
      ) : (
        <BookPlaceholder title={book.title} />
      )}
      <div className="book-info">
        <h3 className="book-title">{book.title}</h3>
        {book.authors.length > 0 && (
          <p className="book-author">
            by {authorList(book.authors)}
            {book.year && <span className="muted"> · {book.year}</span>}
          </p>
        )}
        {book.description && <p className="book-description">{book.description}</p>}
        {children}
      </div>
    </div>
  );
}
