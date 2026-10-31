import { DecoDivider } from "../components/Deco";

export function ComingSoon({ title }: { title: string }) {
  return (
    <section>
      <h1 className="page-title">{title}</h1>
      <DecoDivider />
      <div className="card">
        <p>This section is being built and will be ready soon.</p>
      </div>
    </section>
  );
}
