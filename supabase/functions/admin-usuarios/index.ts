// Edge Function: gestion de cuentas del equipo (solo administradores).
// Acciones: crear, password, activar, eliminar.
// Despliegue: supabase functions deploy admin-usuarios
import { createClient } from "jsr:@supabase/supabase-js@2";

const DOMINIO_USUARIOS = Deno.env.get("DOMINIO_USUARIOS") ?? "equipo.myapedregalejo.es";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respuesta(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function validarPassword(p: unknown): string | null {
  if (typeof p !== "string" || p.length < 8) return "La contraseña debe tener al menos 8 caracteres";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respuesta({ error: "Metodo no permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const servicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const cliente = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await cliente.auth.getUser();
  if (!user) return respuesta({ error: "Sesion no valida" }, 401);

  const admin = createClient(url, servicio, { auth: { persistSession: false } });
  const { data: yo } = await admin.from("perfiles").select("rol, activo").eq("id", user.id).single();
  if (!yo || yo.rol !== "admin" || !yo.activo) return respuesta({ error: "No autorizado" }, 403);

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return respuesta({ error: "Peticion no valida" }, 400);
  }

  switch (cuerpo.accion) {
    case "crear": {
      const usuario = String(cuerpo.usuario ?? "").trim().toLowerCase();
      const nombre = String(cuerpo.nombre ?? "").trim();
      if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
        return respuesta({ error: "El usuario debe tener entre 3 y 30 caracteres (letras, numeros, punto, guion)" }, 400);
      }
      if (!nombre) return respuesta({ error: "El nombre es obligatorio" }, 400);
      const errPass = validarPassword(cuerpo.password);
      if (errPass) return respuesta({ error: errPass }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email: `${usuario}@${DOMINIO_USUARIOS}`,
        password: cuerpo.password as string,
        email_confirm: true,
        user_metadata: { usuario, nombre },
        app_metadata: { creado_por_admin: true },
      });
      if (error) {
        const msg = /already|registered|exists/i.test(error.message) ? "Ese usuario ya existe" : error.message;
        return respuesta({ error: msg }, 400);
      }

      const tarifa = cuerpo.tarifa_hora === null || cuerpo.tarifa_hora === "" || cuerpo.tarifa_hora === undefined
        ? null
        : Number(cuerpo.tarifa_hora);
      const { error: errPerfil } = await admin.from("perfiles").update({
        nombre,
        rol: cuerpo.rol === "admin" ? "admin" : "trabajador",
        tarifa_hora: Number.isFinite(tarifa) ? tarifa : null,
        puesto: (cuerpo.puesto as string) || null,
        telefono: (cuerpo.telefono as string) || null,
      }).eq("id", data.user.id);
      if (errPerfil) return respuesta({ error: errPerfil.message }, 400);

      return respuesta({ ok: true, id: data.user.id });
    }

    case "password": {
      const errPass = validarPassword(cuerpo.password);
      if (errPass) return respuesta({ error: errPass }, 400);
      const { error } = await admin.auth.admin.updateUserById(String(cuerpo.id), {
        password: cuerpo.password as string,
      });
      if (error) return respuesta({ error: error.message }, 400);
      return respuesta({ ok: true });
    }

    case "activar": {
      const id = String(cuerpo.id);
      const activo = Boolean(cuerpo.activo);
      if (id === user.id && !activo) return respuesta({ error: "No puedes desactivar tu propia cuenta" }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: activo ? "none" : "876000h",
      });
      if (error) return respuesta({ error: error.message }, 400);
      await admin.from("perfiles").update({ activo }).eq("id", id);
      return respuesta({ ok: true });
    }

    case "eliminar": {
      const id = String(cuerpo.id);
      if (id === user.id) return respuesta({ error: "No puedes eliminar tu propia cuenta" }, 400);
      const [{ count: nf }, { count: nm }] = await Promise.all([
        admin.from("fichajes").select("id", { count: "exact", head: true }).eq("usuario_id", id),
        admin.from("movimientos").select("id", { count: "exact", head: true }).eq("usuario_id", id),
      ]);
      if ((nf ?? 0) > 0 || (nm ?? 0) > 0) {
        return respuesta({
          error: "Este trabajador tiene fichajes o pagos registrados. Desactiva la cuenta en lugar de eliminarla para conservar el historial",
        }, 400);
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return respuesta({ error: error.message }, 400);
      return respuesta({ ok: true });
    }

    default:
      return respuesta({ error: "Accion desconocida" }, 400);
  }
});
