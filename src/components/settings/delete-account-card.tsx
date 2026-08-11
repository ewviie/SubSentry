"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Deliberately not AlertDialogAction for the destructive button below —
// that primitive closes the dialog on every click, including a failed
// attempt (wrong password, network error). This needs to stay open and
// show the real reason so the user can just retry, the same pattern every
// other error-handling form in this app (EditNameForm, ConnectedAccountRow)
// already uses via its own plain onClick handler.
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (submitting) return; // no closing mid-request
    setOpen(next);
    if (!next) {
      setPassword("");
      setError(null);
    }
  }

  async function handleConfirm() {
    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = data?.message ?? "Couldn't delete your account. Try again.";
        setError(message);
        setPassword("");
        setSubmitting(false);
        return;
      }
      toast.success("Your account has been deleted.");
      // A full navigation, not router.push — every client-side cache/state
      // this session ever built (dashboard data, settings) belongs to an
      // account that no longer exists; a hard reload is what guarantees
      // none of it survives into the logged-out /login render.
      window.location.href = "/login";
    } catch {
      setError("Network error. Try again.");
      setPassword("");
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-destructive/30 shadow-elevation-low">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Permanently delete your account and everything in it. This can&apos;t be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={open} onOpenChange={handleOpenChange}>
          <AlertDialogTrigger render={<Button variant="destructive">Delete account</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes your subscriptions, imports, insights, and any connected
                bank or email accounts. There&apos;s no way to undo this. Enter your password to
                confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="delete-account-password">Password</Label>
              <Input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleConfirm();
                  }
                }}
                disabled={submitting}
                autoFocus
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "delete-account-error" : undefined}
              />
              {error ? (
                <p id="delete-account-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            <AlertDialogFooter>
              {/* h-11 (44px) on both — the Button component's default size
                  is h-8 (32px), fine for the app's normal density but under
                  the ~44px minimum recommended touch-target height; a real
                  mobile audit measured these at ~30px tall. Overridden only
                  here, not in the shared Button component itself, since
                  this is the one irreversible, destructive confirmation in
                  the app where a mis-tap is costliest — not a reason to
                  change every button's height app-wide. */}
              <AlertDialogCancel className="h-11" disabled={submitting}>
                Cancel
              </AlertDialogCancel>
              <Button
                className="h-11"
                variant="destructive"
                onClick={() => void handleConfirm()}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    Deleting…
                  </>
                ) : (
                  "Delete account"
                )}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
