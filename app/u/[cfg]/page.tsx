import WidgetShell from "./WidgetShell";

export default function Page({ params }: { params: { cfg: string } }) {
  return <WidgetShell cfg={params.cfg} />;
}
