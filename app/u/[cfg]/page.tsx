import dynamic from "next/dynamic";

const WidgetClient = dynamic(() => import("./WidgetClient"), { ssr: false });

export default function Page({ params }: { params: { cfg: string } }) {
  return (
    <>
      <style>{`html,body{background:transparent!important;margin:0;padding:0}`}</style>
      <WidgetClient cfg={params.cfg} />
    </>
  );
}
