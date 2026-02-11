/*const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { chromium } = require('playwright');

// =====================================================
// CONFIGURACIÓN GENERAL
// =====================================================
const SUNAT_RUC = process.env.SUNAT_RUC || process.env.SUNAT_RUC;
// soportar ambas convenciones: SUNAT_USER ó SUNAT_USUARIO_SOL
const SUNAT_USER = process.env.SUNAT_USER || process.env.SUNAT_USUARIO_SOL || process.env.SUNAT_USUARIO || null;
// soportar SUNAT_PASS ó SUNAT_CLAVE_SOL
const SUNAT_PASS = process.env.SUNAT_PASS || process.env.SUNAT_CLAVE_SOL || process.env.SUNAT_CLAVE || null;

if (!SUNAT_RUC || !SUNAT_USER || !SUNAT_PASS) {
  console.error('❌ Faltan credenciales SUNAT en el archivo .env. Se buscan estas variables:');
  console.error('  SUNAT_RUC, SUNAT_USER ó SUNAT_USUARIO_SOL, SUNAT_PASS ó SUNAT_CLAVE_SOL');
  console.error('Valores actuales:', { SUNAT_RUC, SUNAT_USER: !!SUNAT_USER, SUNAT_PASS: !!SUNAT_PASS });
  throw new Error('Credenciales SUNAT incompletas');
}

const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Parámetros opcionales para la consulta (pueden venir por env)
const RUC_EMISOR = process.env.RUC_EMISOR || '10416491033';
const SERIE = process.env.SERIE || 'E001';
const NUMERO = process.env.NUMERO || '206';

async function loginSol(page) {
  console.log('🔐 Iniciando sesión en SUNAT SOL...');
  await page.goto('https://www.sunat.gob.pe/sol.html');

  // Manejar popup de "Ingresar"
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    // el segundo link "Ingresar" suele ser el correcto
    page.getByRole('link', { name: 'Ingresar' }).nth(1).click(),
  ]);

  const solPage = popup;
  await solPage.waitForLoadState('networkidle');

  console.log('- Ingresando credenciales...');
  await solPage.getByRole('textbox', { name: 'RUC' }).fill(SUNAT_RUC);
  await solPage.waitForTimeout(1000);
  await solPage.getByRole('textbox', { name: 'Usuario' }).fill(SUNAT_USER);
  await solPage.waitForTimeout(1000);
  await solPage.getByRole('textbox', { name: 'Contraseña' }).fill(SUNAT_PASS);
  await solPage.waitForTimeout(1000);
  await solPage.getByRole('button', { name: 'Iniciar sesión' }).click();

  await solPage.waitForLoadState('networkidle');
  return solPage;
}

async function aplicarManejoPopups(page) {
  try {
    await page.waitForTimeout(3000);
    console.log('🔍 Verificando popups iniciales...');

    const iframeVce = page.frameLocator('iframe[name="ifrVCE"]');

    // Botón Finalizar
    const btnFinCount = await iframeVce.getByRole('button', { name: ' Finalizar' }).count();
    if (btnFinCount > 0) {
      console.log("⚠️ Cerrando modal 'Finalizar'...");
      await iframeVce.getByRole('button', { name: ' Finalizar' }).click();
      await page.waitForTimeout(1000);
    }

    const btnContCount = await iframeVce.getByRole('button', { name: 'Continuar sin confirmar' }).count();
    if (btnContCount > 0) {
      console.log("⚠️ Cerrando modal 'Continuar sin confirmar'...");
      await iframeVce.getByRole('button', { name: 'Continuar sin confirmar' }).click();
      await page.waitForTimeout(1000);
    }
  } catch (err) {
    console.log('ℹ️ Popups no detectados o ya cerrados:', err.message || err);
  }
}

async function irAComprobantes(page) {
  console.log('📄 Navegando al menú de Comprobantes...');
  try {
    console.log('- Paso 0: Click en Empresas');
    await page.getByRole('heading', { name: 'Empresas' }).click().catch(() => {});
    await page.waitForTimeout(800);

    console.log('- Paso 1: Click en Comprobantes de pago');
    await page.getByText('Comprobantes de pago').first().click().catch(() => {});
    await page.waitForTimeout(800);

    console.log('- Paso 2: Click en Comprobantes de Pago (nth 1)');
    await page.getByText('Comprobantes de Pago').nth(1).click().catch(() => {});
    await page.waitForTimeout(800);

    console.log('- Paso 3: Click en Consulta de Comprobantes');
    await page.getByText('Consulta de Comprobantes de').first().click().catch(() => {});
    await page.waitForTimeout(800);

    console.log('- Paso 4: Click en Nueva Consulta');
    await page.getByText('Nueva Consulta de').first().click().catch(() => {});
    await page.waitForTimeout(2000);
  } catch (err) {
    console.log('❌ Error en la navegación:', err.message || err);
  }
}

async function consultarYLlenarForm(page) {
  console.log('📝 Llenando formulario de consulta...');
  try {
    const frameApp = page.frameLocator('iframe[name="iframeApplication"]');

    console.log("- Seleccionando 'Recibido'...");
    await frameApp.getByText('Recibido').click().catch(() => {});

    console.log(`- Ingresando RUC Emisor (${RUC_EMISOR})...`);
    await frameApp.locator('input[name="rucEmisor"]').fill(RUC_EMISOR).catch(() => {});
    await page.waitForTimeout(1000);

    console.log('- Seleccionando Tipo: Factura...');
    await frameApp.getByText('Seleccionar').click().catch(() => {});
    await page.waitForTimeout(1000);
    // seleccionar el item que contiene EXACTAMENTE 'Factura'
    await frameApp.locator('div').filter({ hasText: /^Factura$/ }).click().catch(() => {});
    await page.waitForTimeout(1000);

    console.log(`- Ingresando Serie (${SERIE}) y Número (${NUMERO})...`);
    await frameApp.locator('input[name="serieComprobante"]').fill(SERIE).catch(() => {});
    await page.waitForTimeout(500);
    await frameApp.locator('input[name="numeroComprobante"]').fill(NUMERO).catch(() => {});
    await page.waitForTimeout(500);

    console.log('🚀 ¡Consultando comprobante!');
    await frameApp.getByRole('button', { name: ' Consultar' }).click().catch(() => {});
    await page.waitForTimeout(2000);

    console.log('⬇️ Intentando descargar el XML...');
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        // botón nth(2) en la app suele ser descargar XML
        frameApp.getByRole('button').nth(2).click(),
      ]);

      const suggested = await download.suggestedFilename();
      const filePath = path.join(DOWNLOAD_DIR, suggested || 'downloaded.xml');
      await download.saveAs(filePath);
      console.log(`✅ XML descargado correctamente en: ${filePath}`);
    } catch (err) {
      console.log('⚠️ No se pudo descargar el XML automáticamente:', err.message || err);
    }

    await page.waitForTimeout(1000);
    console.log('✅ Proceso de consulta finalizado.');
  } catch (err) {
    console.log('❌ Error al llenar el formulario:', err.message || err);
  }
}

async function descargarComprobantes(page) {
  console.log('⬇️ Buscando comprobantes...');
  try {
    const rows = page.locator('table tbody tr');
    const total = await rows.count();
    console.log(`🔎 ${total} comprobantes encontrados`);

    for (let i = 0; i < total; i++) {
      const row = rows.nth(i);
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          row.locator('text=XML').click(),
        ]);
        const suggested = await download.suggestedFilename();
        const filePath = path.join(DOWNLOAD_DIR, suggested || `comprobante-${i + 1}.xml`);
        await download.saveAs(filePath);
        console.log(`✅ XML descargado: ${filePath}`);
        await page.waitForTimeout(500);
      } catch (err) {
        console.log(`⚠️ Error en comprobante ${i + 1}:`, err.message || err);
      }
    }
  } catch (err) {
    console.log('⚠️ No se encontraron comprobantes o hubo un error:', err.message || err);
  }
}

async function parsearXml(xmlPath) {
  try {
    // intento usar xml2js si está instalado
    const { parseStringPromise } = require('xml2js');
    const buf = fs.readFileSync(xmlPath);
    const data = await parseStringPromise(buf);
    const invoice = data?.Invoice || data;
    console.log('📄 ID Comprobante:', invoice?.['cbc:ID'] || '(no disponible)');
  } catch (err) {
    console.log('ℹ️ parsearXml: xml2js no está disponible o hubo un error:', err.message || err);
  }
}

async function main() {
  console.log('🚀 Iniciando automatización SUNAT...');
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    const solPage = await loginSol(page);
    await aplicarManejoPopups(solPage);
    await irAComprobantes(solPage);
    await consultarYLlenarForm(solPage);

    console.log('\n🎉 Proceso completado.');

    if (process.env.PAUSE_ON_END === '1') {
      // pausa interactiva opcional
      console.log('Presiona ENTER para cerrar el navegador...');
      await new Promise((resolve) => process.stdin.once('data', resolve));
    }
  } catch (err) {
    console.log('❌ Error en main:', err.message || err);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main();
}*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { chromium } = require('playwright');

// =====================================================
// CONFIGURACIÓN GENERAL
// =====================================================
const SUNAT_RUC = process.env.SUNAT_RUC || process.env.SUNAT_RUC;
// soportar ambas convenciones: SUNAT_USER ó SUNAT_USUARIO_SOL
const SUNAT_USER = process.env.SUNAT_USER || process.env.SUNAT_USUARIO_SOL || process.env.SUNAT_USUARIO || null;
// soportar SUNAT_PASS ó SUNAT_CLAVE_SOL
const SUNAT_PASS = process.env.SUNAT_PASS || process.env.SUNAT_CLAVE_SOL || process.env.SUNAT_CLAVE || null;

if (!SUNAT_RUC || !SUNAT_USER || !SUNAT_PASS) {
  console.error('❌ Faltan credenciales SUNAT en el archivo .env. Se buscan estas variables:');
  console.error('  SUNAT_RUC, SUNAT_USER ó SUNAT_USUARIO_SOL, SUNAT_PASS ó SUNAT_CLAVE_SOL');
  console.error('Valores actuales:', { SUNAT_RUC, SUNAT_USER: !!SUNAT_USER, SUNAT_PASS: !!SUNAT_PASS });
  throw new Error('Credenciales SUNAT incompletas');
}

const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Parámetros opcionales para la consulta (pueden venir por env)
const RUC_EMISOR = process.env.RUC_EMISOR || '10416491033';
const SERIE = process.env.SERIE || 'E001';
const NUMERO = process.env.NUMERO || '206';

async function loginSol(page) {
  console.log('🔐 Iniciando sesión en SUNAT SOL...');
  await page.goto('https://www.sunat.gob.pe/sol.html');

  // Manejar popup de "Ingresar"
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    // el segundo link "Ingresar" suele ser el correcto
    page.getByRole('link', { name: 'Ingresar' }).nth(1).click(),
  ]);

  const solPage = popup;
  await solPage.waitForLoadState('networkidle');

  console.log('- Ingresando credenciales...');
  await solPage.getByRole('textbox', { name: 'RUC' }).fill(SUNAT_RUC);
  await solPage.waitForTimeout(1000);
  await solPage.getByRole('textbox', { name: 'Usuario' }).fill(SUNAT_USER);
  await solPage.waitForTimeout(1000);
  await solPage.getByRole('textbox', { name: 'Contraseña' }).fill(SUNAT_PASS);
  await solPage.waitForTimeout(1000);
  await solPage.getByRole('button', { name: 'Iniciar sesión' }).click();

  await solPage.waitForLoadState('networkidle');
  return solPage;
}

async function aplicarManejoPopups(page) {
  try {
    await page.waitForTimeout(3000);
    console.log('🔍 Verificando popups iniciales...');

    const iframeVce = page.frameLocator('iframe[name="ifrVCE"]');

    // Botón Finalizar
    const btnFinCount = await iframeVce.getByRole('button', { name: ' Finalizar' }).count();
    if (btnFinCount > 0) {
      console.log("⚠️ Cerrando modal 'Finalizar'...");
      await iframeVce.getByRole('button', { name: ' Finalizar' }).click();
      await page.waitForTimeout(1000);
    }

    const btnContCount = await iframeVce.getByRole('button', { name: 'Continuar sin confirmar' }).count();
    if (btnContCount > 0) {
      console.log("⚠️ Cerrando modal 'Continuar sin confirmar'...");
      await iframeVce.getByRole('button', { name: 'Continuar sin confirmar' }).click();
      await page.waitForTimeout(1000);
    }
  } catch (err) {
    console.log('ℹ️ Popups no detectados o ya cerrados:', err.message || err);
  }
}

async function irAComprobantes(page) {
  console.log('📄 Navegando al menú de Comprobantes...');
  try {
    console.log('- Paso 0: Click en Empresas');
    await page.getByRole('heading', { name: 'Empresas' }).click().catch(() => { });
    await page.waitForTimeout(800);

    console.log('- Paso 1: Click en Comprobantes de pago');
    await page.getByText('Comprobantes de pago').first().click().catch(() => { });
    await page.waitForTimeout(800);

    console.log('- Paso 2: Click en Comprobantes de Pago (nth 1)');
    await page.getByText('Comprobantes de Pago').nth(1).click().catch(() => { });
    await page.waitForTimeout(800);

    console.log('- Paso 3: Click en Consulta de Comprobantes');
    await page.getByText('Consulta de Comprobantes de').first().click().catch(() => { });
    await page.waitForTimeout(800);

    console.log('- Paso 4: Click en Nueva Consulta');
    await page.getByText('Nueva Consulta de').first().click().catch(() => { });
    await page.waitForTimeout(2000);
  } catch (err) {
    console.log('❌ Error en la navegación:', err.message || err);
  }
}

async function descargarArchivoPorTooltip(page, frame, tooltipText, tipo) {
  try {
    const selector = `button[ngbtooltip="${tooltipText}"]`;
    const btn = frame.locator(selector);
    const count = await btn.count();

    if (count === 0) {
      console.log(`ℹ️ Omitiendo ${tipo} (Botón no presente)`);
      return false;
    }

    console.log(`⬇️ Intentando descargar ${tipo}...`);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      btn.first().click(),
    ]);

    const suggested = await download.suggestedFilename();
    const filePath = path.join(DOWNLOAD_DIR, suggested || `comprobante.${tipo.toLowerCase()}`);
    await download.saveAs(filePath);
    console.log(`✅ ${tipo} descargado correctamente: ${filePath}`);
    return true;
  } catch (err) {
    console.log(`⚠️ No se pudo descargar el ${tipo}:`, err.message || err);
    return false;
  }
}

async function consultarYLlenarForm(page) {
  console.log('📝 Llenando formulario de consulta...');
  try {
    const frameApp = page.frameLocator('iframe[name="iframeApplication"]');

    console.log("- Seleccionando 'Recibido'...");
    await frameApp.getByText('Recibido').click().catch(() => { });

    console.log(`- Ingresando RUC Emisor (${RUC_EMISOR})...`);
    await frameApp.locator('input[name="rucEmisor"]').fill(RUC_EMISOR).catch(() => { });
    await page.waitForTimeout(1000);

    console.log('- Seleccionando Tipo: Factura...');
    await frameApp.getByText('Seleccionar').click().catch(() => { });
    await page.waitForTimeout(1000);
    // seleccionar el item que contiene EXACTAMENTE 'Factura'
    await frameApp.locator('div').filter({ hasText: /^Factura$/ }).click().catch(() => { });
    await page.waitForTimeout(1000);

    console.log(`- Ingresando Serie (${SERIE}) y Número (${NUMERO})...`);
    await frameApp.locator('input[name="serieComprobante"]').fill(SERIE).catch(() => { });
    await page.waitForTimeout(500);
    await frameApp.locator('input[name="numeroComprobante"]').fill(NUMERO).catch(() => { });
    await page.waitForTimeout(500);

    console.log('🚀 ¡Consultando comprobante!');
    await frameApp.getByRole('button', { name: ' Consultar' }).click().catch(() => { });
    await page.waitForTimeout(2000);

    console.log('⬇️ Iniciando proceso de descargas inteligentes...');

    // Descargar PDF
    const hasPdf = await descargarArchivoPorTooltip(page, frameApp, 'Descargar PDF', 'PDF');
    if (hasPdf) await page.waitForTimeout(7000); // Solo esperar si se descargó

    // Descargar XML
    const hasXml = await descargarArchivoPorTooltip(page, frameApp, 'Descargar XML', 'XML');
    if (hasXml) await page.waitForTimeout(7000); // Solo esperar si se descargó

    // Descargar CDR (Último paso, agregar espera para asegurar escritura en disco)
    const hasCdr = await descargarArchivoPorTooltip(page, frameApp, 'Descargar CDR', 'CDR');
    if (hasCdr) await page.waitForTimeout(5000);

    await page.waitForTimeout(1000);
    console.log('✅ Proceso de consulta y descargas finalizado.');
  } catch (err) {
    console.log('❌ Error al llenar el formulario:', err.message || err);
  }
}

async function descargarComprobantes(page) {
  console.log('⬇️ Buscando comprobantes en la tabla...');
  try {
    const rows = page.locator('table tbody tr');
    const total = await rows.count();
    console.log(`🔎 ${total} comprobantes encontrados`);

    for (let i = 0; i < total; i++) {
      const row = rows.nth(i);
      console.log(`📦 Procesando comprobante ${i + 1}...`);

      // Intentamos descargar los tres si están presentes en la fila con esperas inteligentes
      const hasPdf = await descargarArchivoPorTooltip(row.page(), row, 'Descargar PDF', `PDF-${i + 1}`);
      if (hasPdf) await page.waitForTimeout(7000);

      const hasXml = await descargarArchivoPorTooltip(row.page(), row, 'Descargar XML', `XML-${i + 1}`);
      if (hasXml) await page.waitForTimeout(7000);

      const hasCdr = await descargarArchivoPorTooltip(row.page(), row, 'Descargar CDR', `CDR-${i + 1}`);
      if (hasCdr) await page.waitForTimeout(5000);

      await page.waitForTimeout(1000);
    }
  } catch (err) {
    console.log('⚠️ Error en la descarga masiva:', err.message || err);
  }
}

async function parsearXml(xmlPath) {
  try {
    // intento usar xml2js si está instalado
    const { parseStringPromise } = require('xml2js');
    const buf = fs.readFileSync(xmlPath);
    const data = await parseStringPromise(buf);
    const invoice = data?.Invoice || data;
    console.log('📄 ID Comprobante:', invoice?.['cbc:ID'] || '(no disponible)');
  } catch (err) {
    console.log('ℹ️ parsearXml: xml2js no está disponible o hubo un error:', err.message || err);
  }
}

async function main() {
  console.log('🚀 Iniciando automatización SUNAT...');
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    const solPage = await loginSol(page);
    await aplicarManejoPopups(solPage);
    await irAComprobantes(solPage);
    await consultarYLlenarForm(solPage);

    console.log('\n🎉 Proceso completado.');

    if (process.env.PAUSE_ON_END === '1') {
      // pausa interactiva opcional
      console.log('Presiona ENTER para cerrar el navegador...');
      await new Promise((resolve) => process.stdin.once('data', resolve));
    }
  } catch (err) {
    console.log('❌ Error en main:', err.message || err);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main();
}


