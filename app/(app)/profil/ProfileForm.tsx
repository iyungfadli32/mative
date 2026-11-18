"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { updateProfileAction } from "@/app/(app)/profil/actions";

export default function ProfileForm({
  displayName,
  locale,
  timezone,
}: {
  displayName: string;
  locale: string;
  timezone: string;
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        id="profile-displayName"
        name="displayName"
        label="Nama tampilan"
        defaultValue={displayName}
        required
      />
      <Input
        id="profile-locale"
        name="locale"
        label="Locale (mis. id)"
        defaultValue={locale}
        required
      />
      <Input
        id="profile-timezone"
        name="timezone"
        label="Timezone (IANA, mis. Asia/Jakarta)"
        defaultValue={timezone}
        required
      />
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm text-[var(--mt-teal-700)]">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        Simpan profil
      </Button>
    </form>
  );
}
