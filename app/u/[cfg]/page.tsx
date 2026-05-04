import WidgetShell from "./WidgetShell";

export default async function Page({ params }: { params: Promise<{ cfg: string }> }) {
  const { cfg } = await params;
  return <WidgetShell cfg={cfg} />;
}
