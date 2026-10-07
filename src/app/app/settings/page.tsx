import Link from 'next/link';
import { Monitor, Accessibility, Building2, ArrowUpRight } from 'lucide-react';
export const metadata = { title: 'Settings · Incident Room' };
export default function Page() {
  return (
    <section className="secondary-page utility-page">
      <header className="secondary-page-header">
        <p className="secondary-eyebrow">Application information</p>
        <h1>Settings</h1>
        <p>How this workspace uses your application and browser preferences.</p>
      </header>
      <section className="settings-group">
        <h2>
          <Monitor size={19} aria-hidden="true" /> Display & language
        </h2>
        <dl className="settings-rows">
          <div>
            <dt>Language</dt>
            <dd>
              <strong>English</strong>
              <p>Controlled by the current application configuration.</p>
            </dd>
          </div>
          <div>
            <dt>Dates & times</dt>
            <dd>
              <strong>Incident and message timestamps use UTC</strong>
              <p>
                Search and Notifications also label timestamps with UTC. Action Item due dates are
                calendar dates without timezone conversion.
              </p>
            </dd>
          </div>
        </dl>
      </section>
      <section className="settings-group">
        <h2>
          <Accessibility size={19} aria-hidden="true" /> Accessibility & browser behavior
        </h2>
        <dl className="settings-rows">
          <div>
            <dt>Motion</dt>
            <dd>
              <strong>Follows your system</strong>
              <p>Reduced motion follows your browser or operating system preference.</p>
            </dd>
          </div>
          <div>
            <dt>High contrast</dt>
            <dd>
              <strong>Follows your system</strong>
              <p>Configure high-contrast preferences in your browser or operating system.</p>
            </dd>
          </div>
          <div>
            <dt>Keyboard commands</dt>
            <dd>
              <strong>Ctrl / Cmd K</strong>
              <p>
                Open Commands from outside a text field. Use arrows to navigate, Enter to open and
                Escape to close.
              </p>
            </dd>
          </div>
        </dl>
      </section>
      <section className="settings-group">
        <h2>
          <Building2 size={19} aria-hidden="true" /> Workspace & demo
        </h2>
        <dl className="settings-rows">
          <div>
            <dt>Demo tools</dt>
            <dd>
              <strong>Available in the shell drawer</strong>
              <p>
                Open Demo tools from the application navigation to control fictional faults and
                datasets. These tools do not change Incident permissions.
              </p>
            </dd>
          </div>
          <div>
            <dt>Workspace directory</dt>
            <dd>
              <Link href="/app/team" className="secondary-text-link">
                Browse workspace profiles <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
              <p>Account status describes eligibility, rather than online presence.</p>
            </dd>
          </div>
        </dl>
      </section>
    </section>
  );
}
