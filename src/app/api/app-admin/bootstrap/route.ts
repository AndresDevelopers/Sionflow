import { NextResponse } from "next/server";
import { z } from "zod";
import { authAdmin, firestoreAdmin } from "@/lib/firebase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  APP_ADMIN_BARRIO_ORG,
  getAppAdminEmail,
} from "@/lib/app-admin";
import logger from "@/lib/logger";

const bodySchema = z.object({
  /** Secreto de bootstrap (APP_ADMIN_BOOTSTRAP_SECRET). */
  secret: z.string().min(8).max(256),
  /** Opcional: sobrescribe el password del env solo en esta llamada. */
  password: z.string().min(8).max(128).optional(),
});

/**
 * POST /api/app-admin/bootstrap
 * Crea (o repara) el usuario admin general en Firebase Auth + c_users.
 * Protegido por APP_ADMIN_BOOTSTRAP_SECRET. No es un endpoint público de registro.
 *
 * Credenciales:
 *   email    = APP_ADMIN_EMAIL (default admin@sionflow.app)
 *   password = body.password || APP_ADMIN_PASSWORD
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth");
  if (limited) return limited;

  const expectedSecret = process.env.APP_ADMIN_BOOTSTRAP_SECRET?.trim();
  if (!expectedSecret || expectedSecret.length < 8) {
    return NextResponse.json(
      {
        error:
          "Bootstrap deshabilitado. Define APP_ADMIN_BOOTSTRAP_SECRET (mín. 8 caracteres) en el entorno.",
      },
      { status: 503 }
    );
  }

  try {
    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (parsed.data.secret !== expectedSecret) {
      return NextResponse.json({ error: "Secreto incorrecto." }, { status: 403 });
    }

    const email = getAppAdminEmail();
    const password =
      parsed.data.password?.trim() ||
      process.env.APP_ADMIN_PASSWORD?.trim() ||
      "";

    if (password.length < 8) {
      return NextResponse.json(
        {
          error:
            "Password de admin no configurado. Define APP_ADMIN_PASSWORD o envía password en el body.",
        },
        { status: 400 }
      );
    }

    let uid: string;
    let created = false;
    /** Password reset on re-bootstrap is dangerous if the secret leaks. */
    const allowReset =
      process.env.APP_ADMIN_BOOTSTRAP_ALLOW_RESET === "true" ||
      process.env.APP_ADMIN_BOOTSTRAP_ALLOW_RESET === "1";

    try {
      const existing = await authAdmin.getUserByEmail(email);
      uid = existing.uid;
      if (allowReset) {
        // Explicit recovery mode only
        await authAdmin.updateUser(uid, {
          password,
          emailVerified: true,
          displayName: "Admin General",
          disabled: false,
        });
      } else {
        // Re-run without ALLOW_RESET: repair profile/claims only, never rotate password
        await authAdmin.updateUser(uid, {
          emailVerified: true,
          displayName: "Admin General",
          disabled: false,
        });
        logger.info({
          message:
            "[app-admin/bootstrap] existing admin — password NOT changed (set APP_ADMIN_BOOTSTRAP_ALLOW_RESET=true to allow)",
          uid,
          email,
        });
      }
    } catch (err: unknown) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code !== "auth/user-not-found") {
        throw err;
      }
      const user = await authAdmin.createUser({
        email,
        password,
        emailVerified: true,
        displayName: "Admin General",
        disabled: false,
      });
      uid = user.uid;
      created = true;
    }

    const userRef = firestoreAdmin.collection("c_users").doc(uid);
    await userRef.set(
      {
        uid,
        email,
        name: "Admin General",
        displayName: "Admin General",
        isAppAdmin: true,
        // No es un rol de barrio; no debe gestionarse en admin → users
        role: "secretary",
        permission: "all",
        barrio: "__system__",
        organizacion: "__app_admin__",
        barrioOrg: APP_ADMIN_BARRIO_ORG,
        mainPage: "/app-admin/panel",
        visiblePages: [],
        theme: "system",
        updatedAt: new Date(),
        ...(created ? { createdAt: new Date() } : {}),
      },
      { merge: true }
    );

    // Set custom claim for extra server-side checks if needed later
    await authAdmin.setCustomUserClaims(uid, {
      appAdmin: true,
    });

    logger.info({
      message: "[app-admin/bootstrap] app admin ensured",
      uid,
      email,
      created,
    });

    return NextResponse.json({
      ok: true,
      created,
      passwordUpdated: created || allowReset,
      uid,
      email,
      loginUrl: "/app-admin/login",
      panelUrl: "/app-admin/panel",
      message: created
        ? "Admin general creado. Inicia sesión en /app-admin/login."
        : allowReset
          ? "Admin general actualizado (password incluido). Inicia sesión en /app-admin/login."
          : "Admin general reparado (perfil/claims). Password NO cambiado. Usa APP_ADMIN_BOOTSTRAP_ALLOW_RESET=true solo para recuperación.",
    });
  } catch (error) {
    logger.error({ error, message: "[app-admin/bootstrap] unexpected error" });
    return NextResponse.json(
      { error: "No se pudo crear/actualizar el admin general." },
      { status: 500 }
    );
  }
}
