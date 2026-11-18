import { getCurrentUser, getSupabaseServerClient } from "@/lib/supabase/server";
import { listMyWorkspaces } from "@/features/tenancy/actions";
import { signOutAction } from "@/features/identity/auth";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/States";
import { formatInTimezone } from "@/lib/time";

/**
 * Profil — P1-07. Menampilkan data profil dari `profiles`
 * (id = auth user id). Edit profil: update display_name/locale/timezone
 * lewat server action di bawah (file ini juga berisi form client-nya
 * sebagai komponen terpisah agar page tetap server component).
 */
import ProfileForm from "@/app/(app)/profil/ProfileForm";

type ProfileRow = {
  display_name: string | null;
  locale: string | null;
  timezone: string | null;
};

export default async function ProfilPage() {
  const user = await getCurrentUser();
  const workspaces = await listMyWorkspaces();
  let profile: ProfileRow | null = null;
  const supabase = await getSupabaseServerClient();
  if (supabase && user) {
    const { data } = await supabase
      .from("profiles")
      .select("display_name, locale, timezone")
      .eq("id", user.id)
      .single();
    // Cast lewat unknown: tipe baris Supabase tanpa generic Database adalah
    // never di supabase-js 2.119 — jangan biarkan `never` mempersempit `profile`.
    profile = data as unknown as ProfileRow | null;
  }
  return (
    <AppShell
      workspaceName={workspaces[0]?.workspace.name ?? "Belum ada workspace"}
      userEmail={user?.email ?? null}
      onSignOut={signOutAction}
    >
      <h1 className="text-2xl font-bold">Profil saya</h1>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Data profil Anda. Dibuat otomatis saat daftar (id profil = id akun auth).
      </p>
      <div className="mt-6 max-w-xl rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-5">
        {!user ? (
          <EmptyState
            title="Anda belum masuk"
            description="Masuk dulu untuk melihat dan mengubah profil Anda."
            icon="🔐"
          />
        ) : (
          <>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--mt-text-muted)]">Email</dt>
                <dd className="font-medium">{user.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--mt-text-muted)]">ID akun</dt>
                <dd className="font-mono text-xs">{user.id}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--mt-text-muted)]">Terakhir masuk</dt>
                <dd>{user.last_sign_in_at ? formatInTimezone(user.last_sign_in_at) : "—"}</dd>
              </div>
            </dl>
            <div className="mt-5">
              <ProfileForm
                displayName={profile?.display_name ?? ""}
                locale={profile?.locale ?? "id"}
                timezone={profile?.timezone ?? "Asia/Jakarta"}
              />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
