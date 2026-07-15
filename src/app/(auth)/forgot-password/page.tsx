
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/contexts/i18n-context";

const forgotPasswordSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
});

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();

  const form = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof forgotPasswordSchema>) => {
    try {
      // Rate-limit preflight — response is uniform (no email enumeration).
      const checkResponse = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email.trim() }),
      });

      if (!checkResponse.ok) {
        const data = await checkResponse.json().catch(() => null);
        const errorCode = data?.error as string | undefined;

        let description = t("forgotPassword.toastErrorUnexpected");
        if (errorCode === "invalid-email") {
          description = t("forgotPassword.toastErrorInvalidEmail");
        } else if (checkResponse.status === 429) {
          description = t("forgotPassword.toastErrorTooManyRequests");
        }

        toast({
          title: t("forgotPassword.toastErrorTitle"),
          description,
          variant: "destructive",
        });
        return;
      }

      // Firebase client does not reveal user-not-found for enumeration protection.
      // Always show the same success path after attempting the send.
      try {
        await sendPasswordResetEmail(auth, values.email.trim());
      } catch (sendError: unknown) {
        const code =
          sendError && typeof sendError === "object" && "code" in sendError
            ? String((sendError as { code: unknown }).code)
            : "";
        if (code === "auth/too-many-requests") {
          toast({
            title: t("forgotPassword.toastErrorTitle"),
            description: t("forgotPassword.toastErrorTooManyRequests"),
            variant: "destructive",
          });
          return;
        }
        if (code === "auth/invalid-email") {
          toast({
            title: t("forgotPassword.toastErrorTitle"),
            description: t("forgotPassword.toastErrorInvalidEmail"),
            variant: "destructive",
          });
          return;
        }
        // user-not-found and other codes → same success UX (anti-enumeration)
      }

      toast({
        title: t("forgotPassword.toastSuccessTitle"),
        description: t("forgotPassword.toastSuccessDescription"),
      });
      router.push("/login");
    } catch (error: unknown) {
      console.error("Password Reset Error:", error);
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";

      let description = t("forgotPassword.toastErrorUnexpected");
      if (code === "auth/invalid-email") {
        description = t("forgotPassword.toastErrorInvalidEmail");
      } else if (code === "auth/too-many-requests") {
        description = t("forgotPassword.toastErrorTooManyRequests");
      }

      toast({
        title: t("forgotPassword.toastErrorTitle"),
        description,
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('forgotPassword.title')}</CardTitle>
        <CardDescription>
          {t('forgotPassword.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('forgotPassword.emailLabel')}</FormLabel>
                  <FormControl>
                    <Input placeholder="m@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('forgotPassword.submitButtonLoading') : t('forgotPassword.submitButton')}
            </Button>
          </form>
        </Form>
        <div className="mt-4 text-center text-sm">
          {t('forgotPassword.rememberedPassword')}{" "}
          <Link href="/login" className="underline">
            {t('forgotPassword.loginLink')}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
