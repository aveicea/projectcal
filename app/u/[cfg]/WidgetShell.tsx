import WidgetClient from "./WidgetClient";

export default function WidgetShell({ cfg }: { cfg: string }) {
  return <WidgetClient cfg={cfg} />;
}
