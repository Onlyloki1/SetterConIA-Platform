const { Resend } = require('resend');

const API_KEY = process.env.RESEND_API_KEY;
const resend = API_KEY ? new Resend(API_KEY) : null;
const FROM = process.env.RESEND_FROM_EMAIL || 'Setter con IA <onboarding@resend.dev>';
const PLATFORM_URL = process.env.PLATFORM_URL || 'http://localhost:3000';

async function sendWelcomeEmail(to, name, password) {
  if (!resend) { console.log('RESEND_API_KEY not set — skipping welcome email to:', to); return { success: false, error: 'No API key' }; }
  const loginUrl = `${PLATFORM_URL}/login.html`;

  const html = `
  <div style="font-family:'Poppins',Arial,sans-serif;background:#07111f;color:#a8c8e8;padding:40px 20px;">
    <div style="max-width:560px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:32px;">
        <div style="display:inline-block;width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#4ab8fe,#2196f3);line-height:48px;text-align:center;font-size:20px;font-weight:800;color:#fff;">SI</div>
      </div>
      <div style="background:linear-gradient(140deg,#0c1d30,#091624);border:1px solid rgba(74,184,254,0.15);border-radius:20px;padding:36px;margin-bottom:24px;">
        <h1 style="color:#fff;font-size:24px;margin:0 0 8px;">Bienvenido a Setter con IA${name ? ', ' + name : ''} 🚀</h1>
        <p style="color:#7a93aa;font-size:14px;margin:0 0 28px;">Ya tenés acceso a la plataforma. Acá están tus credenciales para ingresar.</p>

        <div style="background:rgba(74,184,254,0.06);border:1px solid rgba(74,184,254,0.12);border-radius:12px;padding:20px;margin-bottom:28px;">
          <p style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#4ab8fe;margin:0 0 12px;font-weight:600;">Tus credenciales</p>
          <p style="color:#fff;font-size:15px;margin:0 0 6px;"><strong>Email:</strong> ${to}</p>
          <p style="color:#fff;font-size:15px;margin:0;"><strong>Contraseña:</strong> ${password}</p>
        </div>

        <a href="${loginUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#4ab8fe,#2196f3);color:#fff;font-size:15px;font-weight:700;padding:16px;border-radius:12px;text-decoration:none;letter-spacing:0.5px;">Ingresar a la plataforma →</a>
      </div>

      <div style="background:linear-gradient(140deg,#0c1d30,#091624);border:1px solid rgba(74,184,254,0.08);border-radius:16px;padding:28px;">
        <h2 style="color:#fff;font-size:16px;margin:0 0 20px;">Tus primeros pasos:</h2>
        <div style="margin-bottom:14px;display:flex;gap:12px;">
          <div style="width:28px;height:28px;border-radius:50%;background:rgba(74,184,254,0.12);color:#4ab8fe;text-align:center;line-height:28px;font-size:13px;font-weight:700;flex-shrink:0;">1</div>
          <div><p style="color:#fff;font-size:14px;margin:0;font-weight:600;">Mirá el video de bienvenida</p><p style="color:#7a93aa;font-size:12px;margin:4px 0 0;">Es corto y tiene todo lo que necesitás saber para arrancar.</p></div>
        </div>
        <div style="margin-bottom:14px;display:flex;gap:12px;">
          <div style="width:28px;height:28px;border-radius:50%;background:rgba(74,184,254,0.12);color:#4ab8fe;text-align:center;line-height:28px;font-size:13px;font-weight:700;flex-shrink:0;">2</div>
          <div><p style="color:#fff;font-size:14px;margin:0;font-weight:600;">Completá el formulario de información</p><p style="color:#7a93aa;font-size:12px;margin:4px 0 0;">Necesitamos saber un poco sobre vos y tu negocio.</p></div>
        </div>
        <div style="margin-bottom:14px;display:flex;gap:12px;">
          <div style="width:28px;height:28px;border-radius:50%;background:rgba(74,184,254,0.12);color:#4ab8fe;text-align:center;line-height:28px;font-size:13px;font-weight:700;flex-shrink:0;">3</div>
          <div><p style="color:#fff;font-size:14px;margin:0;font-weight:600;">Completá el segundo formulario</p><p style="color:#7a93aa;font-size:12px;margin:4px 0 0;">Unos datos más para personalizar tu experiencia.</p></div>
        </div>
        <div style="display:flex;gap:12px;">
          <div style="width:28px;height:28px;border-radius:50%;background:rgba(37,211,102,0.12);color:#25d366;text-align:center;line-height:28px;font-size:13px;font-weight:700;flex-shrink:0;">4</div>
          <div><p style="color:#fff;font-size:14px;margin:0;font-weight:600;">Enviá un WhatsApp para arrancar</p><p style="color:#7a93aa;font-size:12px;margin:4px 0 0;">Confirmá que completaste todo y empezamos.</p></div>
        </div>
      </div>

      <p style="text-align:center;color:#4a6275;font-size:11px;margin-top:32px;">Setter con IA — Plataforma de Clientes</p>
    </div>
  </div>`;

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: [to],
      subject: '🚀 Bienvenido a Setter con IA — Tus credenciales',
      html,
    });
    console.log('Welcome email sent to:', to, result);
    return { success: true, id: result.id };
  } catch (err) {
    console.error('Failed to send welcome email:', err);
    return { success: false, error: err.message };
  }
}

async function sendExpiryReminder(to, name, daysLeft) {
  if (!resend) { console.log('RESEND_API_KEY not set — skipping expiry reminder to:', to); return { success: false, error: 'No API key' }; }
  const loginUrl = `${PLATFORM_URL}/login.html`;

  const urgency = daysLeft <= 3 ? '🔴 URGENTE' : daysLeft <= 7 ? '🟡 Importante' : '📅 Recordatorio';
  const html = `
  <div style="font-family:'Poppins',Arial,sans-serif;background:#07111f;color:#a8c8e8;padding:40px 20px;">
    <div style="max-width:560px;margin:0 auto;">
      <div style="background:linear-gradient(140deg,#0c1d30,#091624);border:1px solid rgba(74,184,254,0.15);border-radius:20px;padding:36px;">
        <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${daysLeft<=3?'#e74c3c':daysLeft<=7?'#f59e0b':'#4ab8fe'};margin:0 0 16px;">${urgency}</p>
        <h1 style="color:#fff;font-size:22px;margin:0 0 12px;">Tu plan vence en ${daysLeft} día${daysLeft!==1?'s':''}</h1>
        <p style="color:#7a93aa;font-size:14px;margin:0 0 28px;">Hola${name?' '+name:''}. Te recordamos que tu acceso a Setter con IA está por vencer. Contactá al administrador para renovar tu plan y no perder el acceso.</p>
        <a href="${loginUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#4ab8fe,#2196f3);color:#fff;font-size:15px;font-weight:700;padding:16px;border-radius:12px;text-decoration:none;">Ir a la plataforma →</a>
      </div>
      <p style="text-align:center;color:#4a6275;font-size:11px;margin-top:32px;">Setter con IA — Plataforma de Clientes</p>
    </div>
  </div>`;

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: [to],
      subject: `${urgency} — Tu plan de Setter con IA vence en ${daysLeft} días`,
      html,
    });
    console.log('Expiry reminder sent to:', to, '(' + daysLeft + ' days)');
    return { success: true };
  } catch (err) {
    console.error('Failed to send expiry reminder:', err);
    return { success: false, error: err.message };
  }
}

module.exports = { sendWelcomeEmail, sendExpiryReminder };
