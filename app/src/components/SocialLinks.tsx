import { SOCIAL_LINKS } from "../config";
import { BrandMark, brandName } from "./BrandIcons";

/**
 * The outbound links, as marks only.
 *
 * Icon-only because these are four logos people already recognise, and because
 * the row sits inline beside the wordmark — labels would push it onto a second
 * line and cost vertical space in the one place the page cannot afford it.
 *
 * Nothing is hidden before launch. A market link with no URL renders dimmed
 * and unclickable rather than disappearing, so the row does not reflow on
 * launch day and a visitor can see that a chart is coming rather than assuming
 * there isn't one. The accessible name carries that state, since there is no
 * visible text to carry it.
 */
export function SocialLinks() {
  return (
    <nav className="social" aria-label="Community and market links">
      {SOCIAL_LINKS.map((l) => {
        const name = brandName(l.id);

        return l.url ? (
          <a
            key={l.id}
            className="social-link"
            href={l.url}
            title={l.title}
            aria-label={name}
            target="_blank"
            rel="noreferrer noopener"
          >
            <BrandMark id={l.id} />
          </a>
        ) : (
          <span
            key={l.id}
            className="social-link is-pending"
            title={l.title}
            role="img"
            aria-label={`${name} — live at launch`}
          >
            <BrandMark id={l.id} />
          </span>
        );
      })}
    </nav>
  );
}
