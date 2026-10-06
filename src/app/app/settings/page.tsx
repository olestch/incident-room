import Link from 'next/link';
export const metadata = { title: 'Settings · Incident Room' };
export default function Page() {
  return (
    <section>
      <h1 className="text-3xl font-semibold">Settings</h1>
      <p className="mt-4">
        Display language: English. Incident dates use explicit UTC; message dates use your browser
        locale.
      </p>
      <p className="mt-3">
        Reduced motion and high-contrast preferences follow your browser or operating system.
        Configure them there; no account preference service is simulated.
      </p>
      <p className="mt-3">
        Demo Mode above controls fictional faults and datasets. These are demonstration tools, not
        Incident permissions.
      </p>
      <Link className="mt-4 inline-block underline" href="/app/team">
        Browse workspace profiles
      </Link>
    </section>
  );
}
