import { ArrowRight, Check, MessageSquare, Radio } from 'lucide-react';
import { Avatar, Badge } from '@/shared/ui/primitives';

export function ProductPreview() {
  return (
    <figure className="product-preview" aria-label="Illustrative Incident Room preview">
      <div className="preview-command">
        <div className="preview-command-meta">
          <span className="preview-id">INC-2841</span>
          <Badge className="preview-severity">P1 Critical</Badge>
          <Badge className="preview-lifecycle">
            <Radio size={12} aria-hidden="true" />
            Monitoring
          </Badge>
        </div>
        <p className="preview-title">Elevated edge latency · region 1</p>
        <p className="preview-subtitle">
          Aurora Edge <span aria-hidden="true">·</span> Response activity
        </p>
      </div>
      <div className="preview-columns">
        <div className="preview-timeline">
          <div className="preview-panel-title">
            <span>Timeline</span>
            <span className="preview-live">
              <span />
              Live context
            </span>
          </div>
          <ol className="preview-entries" aria-label="Illustrative Timeline">
            <li className="preview-system">
              <span className="preview-event-node" aria-hidden="true" />
              <div>
                <p>
                  <strong>Incident identified</strong>
                  <time>14:06</time>
                </p>
                <p>Connection pool saturation isolated.</p>
              </div>
            </li>
            <li className="preview-message">
              <Avatar name="River Vale" />
              <div>
                <p className="preview-author">
                  <strong>River Vale</strong>
                  <time>14:08</time>
                </p>
                <p>
                  Pool limit adjusted. Latency is returning to baseline; watching the next traffic
                  window.
                </p>
                <span className="preview-thread-reference">
                  <MessageSquare size={13} aria-hidden="true" />1 reply{' '}
                  <ArrowRight size={12} aria-hidden="true" />
                </span>
              </div>
            </li>
            <li className="preview-system">
              <span className="preview-event-node preview-node-teal" aria-hidden="true" />
              <div>
                <p>
                  <strong>Moved to Monitoring</strong>
                  <time>14:09</time>
                </p>
                <p>Mitigation applied. Recovery under observation.</p>
              </div>
            </li>
          </ol>
          <div className="preview-delivery">
            <Check size={13} aria-hidden="true" />
            Shared response history
          </div>
        </div>
        <div className="preview-thread">
          <div className="preview-panel-title">
            <span>Thread</span>
            <MessageSquare size={15} aria-hidden="true" />
          </div>
          <p className="preview-thread-context">
            On River’s update <span>14:08</span>
          </p>
          <blockquote>Pool limit adjusted. Latency is returning to baseline…</blockquote>
          <div className="preview-message">
            <Avatar name="Sage Linden" />
            <div>
              <p className="preview-author">
                <strong>Sage Linden</strong>
                <time>14:10</time>
              </p>
              <p>Checked the next window. Requests are steady; keeping the investigation here.</p>
            </div>
          </div>
          <p className="preview-context-note">
            Investigation stays connected to its Timeline event.
          </p>
        </div>
      </div>
      <figcaption>Illustrative preview · Fictional incident and conversation</figcaption>
    </figure>
  );
}
