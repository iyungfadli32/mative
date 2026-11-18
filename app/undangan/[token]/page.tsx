import TerimaUndanganPage from "@/app/undangan/[token]/page-client";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TerimaUndanganPage token={token} />;
}
