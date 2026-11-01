import type { BookReview, PlaceReview, Source } from "../types";

function isBookReview(r: BookReview | PlaceReview): r is BookReview {
  return "criticSentiment" in r;
}

/** AI-written summary of public reviews, with sources. */
export function ReviewSummary({ review }: { review: BookReview | PlaceReview }) {
  return (
    <div className="review">
      <p>{review.overall}</p>
      {isBookReview(review) ? (
        <dl className="review-facts">
          <Fact label="Critics" value={review.criticSentiment} />
          <Fact label="Readers" value={review.readerSentiment} />
          <Fact label="Genre" value={review.genre} />
          {review.pageCount && <Fact label="Length" value={`About ${review.pageCount} pages`} />}
        </dl>
      ) : (
        <dl className="review-facts">
          <Fact label="Price" value={review.priceRange} />
          <Fact label="Noise" value={review.noise} />
          <Fact label="Parking" value={review.parking} />
          <Fact label="Accessibility" value={review.accessibility} />
          <Fact label="For our group" value={review.groups} />
        </dl>
      )}
      <div className="review-lists">
        {review.praise.length > 0 && (
          <div>
            <h4 className="section-label">People liked</h4>
            <ul>
              {review.praise.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        {review.criticism.length > 0 && (
          <div>
            <h4 className="section-label">Common complaints</h4>
            <ul>
              {review.criticism.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {isBookReview(review) && review.disagreements && (
        <p>
          <strong>Where opinions differ:</strong> {review.disagreements}
        </p>
      )}
      <Sources sources={review.sources} />
      <p className="hint">Summary written by AI from public reviews. It may contain mistakes.</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Sources({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <details className="sources">
      <summary>Sources ({sources.length})</summary>
      <ul>
        {sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer noopener">
              {s.title}
            </a>{" "}
            <span className="muted">({new URL(s.url).hostname.replace(/^www\./, "")})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Shown while the AI is researching. */
export function ReviewLoading({ what }: { what: string }) {
  return (
    <div className="review-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <div>
        <p className="strong">Looking up what people say about {what}…</p>
        <p className="hint">This usually takes 30 to 60 seconds. Please keep this page open.</p>
      </div>
    </div>
  );
}

export function ReviewUnavailable() {
  return (
    <div className="notice">
      <p>Reviews aren't available right now. You can still suggest it, and reviews can be added later.</p>
    </div>
  );
}
