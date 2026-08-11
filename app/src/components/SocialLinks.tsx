import { SOCIAL_LINKS } from "../config";
import { BRAND_ICONS } from "./BrandIcons";

/**
 * The outbound link row under the wordmark.
 *
 * Links with no URL are rendered as disabled spans rather than hidden. Hiding
 * them would leave visitors wondering where the chart is; showing them greyed
 * with "soon" answers the question before it is asked, and the row does not
 * reflow on launch day when the URLs land.
 *
 * Each one carries its name as text, not just a glyph — three of the four
 * marks are not reproducible faithfully at this size, so the label is what
 * actually identifies them.
 */
export function SocialLinks() {
  return (
    <nav className="social" aria-label="Community and market links">
      {SOCIAL_LINKS.map((l) => {
        const Icon = BRAND_ICONS[l.id];
        const content = (
          <>
            <Icon />
            <span className="social-label">{l.label}</span>
          </>
        );

        return l.url ? (
          <a
            key={l.id}
            className="social-link"
            href={l.url}
            title={l.title}
            target="_blank"
            rel="noreferrer noopener"
          >
            {content}
          </a>
        ) : (
          <span
            key={l.id}
            className="social-link is-pending"
            title={l.title}
            aria-disabled="true"
          >
            {content}
            <span className="social-soon">soon</span>
          </span>
        );
      })}
    </nav>
  );
}
