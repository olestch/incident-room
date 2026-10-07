import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  GitBranch,
  Layers,
  Link2,
  MessageSquare,
  RefreshCw,
  Send,
} from 'lucide-react';
import { BrandMark, SignalChannels } from '@/shared/ui/brand';
import { ProductPreview } from './_public/product-preview';

const description =
  'Coordinate incident response with a realtime Timeline, contextual Threads and recovery that keeps the team in sync. Explore a fictional portfolio workspace.';
export const metadata: Metadata = {
  title: 'Incident Room — Coordinate the response',
  description,
  openGraph: { title: 'Incident Room — Coordinate the response', description, type: 'website' },
};
const repository = 'https://github.com/olestch/incident-room';
const highlights = [
  {
    icon: Layers,
    title: '50k events. A focused view.',
    copy: 'Explore variable-height Timeline histories with bounded rendering and a stable scroll anchor.',
  },
  {
    icon: Send,
    title: 'Delivery that survives disruption.',
    copy: 'Persistent drafts and an outbox keep work recoverable, with clear sending, uncertain and failed states.',
  },
  {
    icon: RefreshCw,
    title: 'A shared story, back in sync.',
    copy: 'Reconnect and resync reconcile missed, duplicate and out-of-order activity into a converged view.',
  },
  {
    icon: MessageSquare,
    title: 'Investigation in context.',
    copy: 'Threads keep replies, their own history and drafts connected to the original Timeline event.',
  },
  {
    icon: Link2,
    title: 'Go straight to the evidence.',
    copy: 'Open a specific event or Thread by link without stepping through the whole history.',
  },
  {
    icon: GitBranch,
    title: 'Learn without silent overwrites.',
    copy: 'Postmortem editing detects revision conflicts so concurrent changes can be resolved deliberately.',
  },
];
const workflow = [
  ['Triggered', 'Capture the signal'],
  ['Investigating', 'Build shared context'],
  ['Identified', 'Record the cause'],
  ['Monitoring', 'Observe recovery'],
  ['Resolved', 'Close the response'],
];

export default function HomePage() {
  return (
    <div className="public-page">
      <header className="public-header public-width">
        <Link href="/" className="public-brand">
          <BrandMark />
          <span>Incident Room</span>
        </Link>
        <nav aria-label="Public navigation">
          <Link href="#capabilities" className="public-nav-anchor">
            Capabilities
          </Link>
          <Link href="#workflow" className="public-nav-anchor">
            Workflow
          </Link>
          <Link href="/login" className="public-sign-in">
            Sign in
          </Link>
          <Link href="/login" className="ui-button ui-button-primary">
            Open demo <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1}>
        <section className="public-hero public-width" aria-labelledby="hero-title">
          <SignalChannels />
          <div className="public-hero-copy">
            <p className="public-eyebrow">
              <span className="public-signal-dot" />
              Realtime incident coordination
            </p>
            <h1 id="hero-title">
              Coordinate the response.
              <br />
              <span>Keep the full story.</span>
            </h1>
            <p className="public-lead">
              Bring incident response into one shared Timeline, with Threads for the investigation
              and recovery that keeps everyone in sync.
            </p>
            <div className="public-actions">
              <Link href="/login" className="ui-button ui-button-primary">
                Explore demo <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link href="#capabilities" className="public-text-link">
                See what’s inside <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <p className="public-demo-note">Fictional workspace · Sign in with the demo account</p>
          </div>
          <div className="public-preview-stage">
            <p className="public-preview-label">
              <span>01 / Response room</span>
              <span>From signal to shared context</span>
            </p>
            <ProductPreview />
          </div>
        </section>
        <section
          id="capabilities"
          className="public-capabilities public-width"
          aria-labelledby="capabilities-title"
        >
          <div className="public-section-heading">
            <div>
              <p className="public-eyebrow">Built around the response</p>
              <h2 id="capabilities-title">
                Context holds.
                <br />
                Even when the connection doesn’t.
              </h2>
            </div>
            <p>
              Explore collaboration under load, interrupted delivery and recovery. The demo makes
              these behaviors visible.
            </p>
          </div>
          <div className="public-highlights">
            {highlights.map(({ icon: Icon, title, copy }, index) => (
              <article key={title}>
                <div className="public-highlight-label">
                  <Icon size={20} aria-hidden="true" />
                  <span>0{index + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="workflow" className="public-workflow" aria-labelledby="workflow-title">
          <div className="public-width">
            <div className="public-section-heading">
              <div>
                <p className="public-eyebrow">One continuous response</p>
                <h2 id="workflow-title">From the first signal to what comes next.</h2>
              </div>
              <p>
                Lifecycle changes and conversation share a chronology. Capture the lessons afterward
                in a Postmortem.
              </p>
            </div>
            <ol className="public-workflow-rail">
              {workflow.map(([state, caption], index) => (
                <li key={state}>
                  <span className="public-workflow-node">0{index + 1}</span>
                  <h3>{state}</h3>
                  <p>{caption}</p>
                </li>
              ))}
            </ol>
            <p className="public-postmortem">
              <GitBranch size={17} aria-hidden="true" />
              <strong>Postmortem</strong>
              <span>Carry the response history into shared learning.</span>
            </p>
          </div>
        </section>
        <section className="public-invitation public-width" aria-labelledby="demo-title">
          <BrandMark />
          <div>
            <p className="public-eyebrow">A working portfolio product</p>
            <h2 id="demo-title">Step into the response room.</h2>
            <p>
              Explore fictional incidents in a deterministic, browser-simulated environment. Try
              realtime, delivery failures and large histories through the Demo controls.
            </p>
          </div>
          <Link href="/login" className="ui-button ui-button-primary">
            Enter demo workspace <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </section>
      </main>
      <footer className="public-footer public-width">
        <span>
          Incident Room <span aria-hidden="true">/</span> Portfolio demo
        </span>
        <a href={repository} className="public-text-link">
          Source on GitHub <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
