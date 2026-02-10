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
const fs = require('fs'); // Módulo de Node.js para interactuar con el sistema de archivos (leer/escribir).
const path = require('path'); // Módulo de Node.js para manejar rutas de archivos de forma segura.
require('dotenv').config(); // Carga las variables de entorno definidas en el archivo .env a process.env.
const { chromium } = require('playwright'); // Importa el motor Chromium de Playwright para la automatización del navegador.

// =====================================================
// CONFIGURACIÓN GENERAL
// =====================================================

// Obtiene el RUC de las variables de entorno.
const SUNAT_RUC = process.env.SUNAT_RUC || process.env.SUNAT_RUC;

// Obtiene el usuario SOL (soporta múltiples nombres de variables de entorno para mayor flexibilidad).
const SUNAT_USER = process.env.SUNAT_USER || process.env.SUNAT_USUARIO_SOL || process.env.SUNAT_USUARIO || null;

// Obtiene la clave SOL (soporta múltiples nombres de variables de entorno).
const SUNAT_PASS = process.env.SUNAT_PASS || process.env.SUNAT_CLAVE_SOL || process.env.SUNAT_CLAVE || null;

// Valida que las credenciales obligatorias estén presentes; si no, lanza un error descriptivo.
if (!SUNAT_RUC || !SUNAT_USER || !SUNAT_PASS) {
  console.error('❌ Faltan credenciales SUNAT en el archivo .env. Se buscan estas variables:');
  console.error('  SUNAT_RUC, SUNAT_USER ó SUNAT_USUARIO_SOL, SUNAT_PASS ó SUNAT_CLAVE_SOL');
  console.error('Valores actuales:', { SUNAT_RUC, SUNAT_USER: !!SUNAT_USER, SUNAT_PASS: !!SUNAT_PASS });
  throw new Error('Credenciales SUNAT incompletas');
}

// Define el directorio donde se guardarán las descargas (por defecto la carpeta 'downloads').
const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || 'downloads');

// Crea el directorio de descargas si no existe físicamente en el disco.
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Parámetros de búsqueda por defecto para el comprobante (se pueden sobreescribir vía env).
const RUC_EMISOR = process.env.RUC_EMISOR || '10416491033';
const SERIE = process.env.SERIE || 'E001';
const NUMERO = process.env.NUMERO || '206';

/**
 * Función que gestiona el inicio de sesión en el portal SOL de SUNAT.
 * @param {Page} page - Objeto página de Playwright.
 */
async function loginSol(page) {
  console.log('🔐 Iniciando sesión en SUNAT SOL...');
  await page.goto('https://www.sunat.gob.pe/sol.html'); // Navega a la URL principal del portal SOL.

  // Inicia la espera de una nueva pestaña (popup) y hace el clic que la dispara simultáneamente.
  const [popup] = await Promise.all([
    page.waitForEvent('popup'), // Espera a que se abra la ventana emergente de login.
    page.getByRole('link', { name: 'Ingresar' }).nth(1).click(), // Hace clic en el segundo botón "Ingresar" del portal.
  ]);

  const solPage = popup; // Referenciamos la nueva pestaña del formulario de login.
  await solPage.waitForLoadState('networkidle'); // Espera a que la red esté inactiva (página cargada).

  console.log('- Ingresando credenciales...');
  await solPage.getByRole('textbox', { name: 'RUC' }).fill(SUNAT_RUC); // Escribe el RUC en el campo correspondiente.
  await solPage.waitForTimeout(1000); // Pequeña pausa de 1 segundo para evitar bloqueos por velocidad.
  await solPage.getByRole('textbox', { name: 'Usuario' }).fill(SUNAT_USER); // Escribe el Usuario SOL.
  await solPage.waitForTimeout(1000); // Pausa táctica.
  await solPage.getByRole('textbox', { name: 'Contraseña' }).fill(SUNAT_PASS); // Escribe la Contraseña/Clave SOL.
  await solPage.waitForTimeout(1000); // Pausa táctica.
  await solPage.getByRole('button', { name: 'Iniciar sesión' }).click(); // Presiona el botón de acceso.

  await solPage.waitForLoadState('networkidle'); // Espera a que el portal principal cargue tras el login.
  return solPage; // Devuelve el contexto de la página donde ya estamos logueados.
}

/**
 * Función para cerrar automáticamente los popups/modales invasivos de SUNAT tras loguearse.
 * @param {Page} page - Objeto página de Playwright.
 */
async function aplicarManejoPopups(page) {
  try {
    await page.waitForTimeout(3000); // Espera 3 segundos a que los popups dinámicos aparezcan.
    console.log('🔍 Verificando popups iniciales...');

    // Los popups de SUNAT suelen vivir dentro de un iframe específico llamado 'ifrVCE'.
    const iframeVce = page.frameLocator('iframe[name="ifrVCE"]');

    // Verifica si el botón 'Finalizar' existe en el modal de avisos.
    const btnFinCount = await iframeVce.getByRole('button', { name: ' Finalizar' }).count();
    if (btnFinCount > 0) {
      console.log("⚠️ Cerrando modal 'Finalizar'...");
      await iframeVce.getByRole('button', { name: ' Finalizar' }).click(); // Cierra el modal de encuestas o noticias.
      await page.waitForTimeout(1000); // Espera que el modal desaparezca.
    }

    // Verifica si hay un modal de confirmación de datos de contacto.
    const btnContCount = await iframeVce.getByRole('button', { name: 'Continuar sin confirmar' }).count();
    if (btnContCount > 0) {
      console.log("⚠️ Cerrando modal 'Continuar sin confirmar'...");
      await iframeVce.getByRole('button', { name: 'Continuar sin confirmar' }).click(); // Omite la confirmación.
      await page.waitForTimeout(1000); // Pausa táctica.
    }
  } catch (err) {
    console.log('ℹ️ Popups no detectados o ya cerrados:', err.message || err); // Maneja errores silenciosamente si no hay popups.
  }
}

/**
 * Navega a través de los menús internos de SUNAT hasta llegar al formulario de consulta.
 * @param {Page} page - Objeto página de Playwright.
 */
async function irAComprobantes(page) {
  console.log('📄 Navegando al menú de Comprobantes...');
  try {
    console.log('- Paso 0: Click en Empresas');
    await page.getByRole('heading', { name: 'Empresas' }).click().catch(() => { }); // Selecciona la pestaña 'Empresas'.
    await page.waitForTimeout(800); // Pausa entre clics.

    console.log('- Paso 1: Click en Comprobantes de pago');
    await page.getByText('Comprobantes de pago').first().click().catch(() => { }); // Abre la sección de comprobantes.
    await page.waitForTimeout(800);

    console.log('- Paso 2: Click en Comprobantes de Pago (nth 1)');
    await page.getByText('Comprobantes de Pago').nth(1).click().catch(() => { }); // Click en el submenú de comprobantes.
    await page.waitForTimeout(800);

    console.log('- Paso 3: Click en Consulta de Comprobantes');
    await page.getByText('Consulta de Comprobantes de').first().click().catch(() => { }); // Abre la opción de consulta específica.
    await page.waitForTimeout(800);

    console.log('- Paso 4: Click en Nueva Consulta');
    await page.getByText('Nueva Consulta de').first().click().catch(() => { }); // Selecciona 'Nueva Consulta'.
    await page.waitForTimeout(2000); // Espera mayor porque aquí suele cargar un iframe pesado.
  } catch (err) {
    console.log('❌ Error en la navegación:', err.message || err);
  }
}

/**
 * Interactúa con el formulario dentro del iframe y descarga el comprobante solicitado.
 * @param {Page} page - Objeto página de Playwright.
 */
async function consultarYLlenarForm(page) {
  console.log('📝 Llenando formulario de consulta...');
  try {
    // La aplicación de consulta vive dentro de un iframe llamado 'iframeApplication'.
    const frameApp = page.frameLocator('iframe[name="iframeApplication"]');

    console.log("- Seleccionando 'Recibido'...");
    await frameApp.getByText('Recibido').click().catch(() => { }); // Marca la opción para buscar facturas recibidas (de proveedores).

    console.log(`- Ingresando RUC Emisor (${RUC_EMISOR})...`);
    await frameApp.locator('input[name="rucEmisor"]').fill(RUC_EMISOR).catch(() => { }); // Llena el RUC del proveedor.
    await page.waitForTimeout(1000);

    console.log('- Seleccionando Tipo: Factura...');
    await frameApp.getByText('Seleccionar').click().catch(() => { }); // Abre el dropdown de tipos de comprobantes.
    await page.waitForTimeout(1000);
    // Filtra las opciones del dropdown para hacer clic exactamente en la que dice 'Factura'.
    await frameApp.locator('div').filter({ hasText: /^Factura$/ }).click().catch(() => { });
    await page.waitForTimeout(1000);

    console.log(`- Ingresando Serie (${SERIE}) y Número (${NUMERO})...`);
    await frameApp.locator('input[name="serieComprobante"]').fill(SERIE).catch(() => { }); // Llena el campo de la serie del documento.
    await page.waitForTimeout(500);
    await frameApp.locator('input[name="numeroComprobante"]').fill(NUMERO).catch(() => { }); // Llena el número correlativo.
    await page.waitForTimeout(500);

    console.log('🚀 ¡Consultando comprobante!');
    await frameApp.getByRole('button', { name: ' Consultar' }).click().catch(() => { }); // Envía el formulario de búsqueda.
    await page.waitForTimeout(2000); // Da tiempo a que aparezca la tabla de resultados.

    console.log('⬇️ Intentando descargar los comprobantes (XML y PDF)...');
    try {
      // 1. Descarga del XML usando el tooltip capturado
      const [xmlDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        frameApp.locator('button[ngbtooltip="Descargar XML"]').click(),
      ]);
      const xmlPath = path.join(DOWNLOAD_DIR, await xmlDownload.suggestedFilename());
      await xmlDownload.saveAs(xmlPath);
      console.log(`✅ XML descargado: ${await xmlDownload.suggestedFilename()}`);

      // 2. Descarga del PDF usando el tooltip capturado
      const [pdfDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        frameApp.locator('button[ngbtooltip="Descargar PDF"]').click(),
      ]);
      const pdfPath = path.join(DOWNLOAD_DIR, await pdfDownload.suggestedFilename());
      await pdfDownload.saveAs(pdfPath);
      console.log(`✅ PDF descargado: ${await pdfDownload.suggestedFilename()}`);

      // 3. Descarga del CDR con alta robustez (SUNAT suele tardar en generarlo)
      try {
        const cdrLocator = frameApp.locator('button[ngbtooltip="Descargar CDR"]');

        console.log('⏳ Esperando a que el botón CDR sea visible (máx 20s)...');
        // Esperamos hasta 20 segundos ya que el CDR es el último archivo en generarse internamente en SUNAT.
        await cdrLocator.waitFor({ state: 'visible', timeout: 20000 }).catch(() => { });

        if (await cdrLocator.isVisible()) {
          console.log('🔘 Botón CDR detectado, iniciando descarga...');
          const [cdrDl] = await Promise.all([
            page.waitForEvent('download', { timeout: 20000 }),
            cdrLocator.click({ force: true }), // force: true asegura el clic incluso si el icono interno lo cubre.
          ]);
          const cdrPath = path.join(DOWNLOAD_DIR, await cdrDl.suggestedFilename());
          await cdrDl.saveAs(cdrPath);
          console.log(`✅ CDR descargado: ${await cdrDl.suggestedFilename()}`);
        } else {
          console.log('ℹ️ El botón CDR no apareció tras 20s. Es probable que este comprobante no lo tenga.');
        }
      } catch (e) {
        console.log('ℹ️ Error al intentar descargar CDR:', e.message || e);
      }

    } catch (err) {
      console.log('⚠️ Error en la descarga automatizada:', err.message || err);
    }

    await page.waitForTimeout(1000); // Pausa final.
    console.log('✅ Proceso de consulta finalizado.');
  } catch (err) {
    console.log('❌ Error al llenar el formulario:', err.message || err);
  }
}

/**
 * Intenta iterar sobre una tabla de resultados (si existen múltiples) y descargar sus XMLs.
 * @param {Page} page - Objeto página de Playwright.
 */
async function descargarComprobantes(page) {
  console.log('⬇️ Buscando comprobantes...');
  try {
    const rows = page.locator('table tbody tr'); // Localiza las filas de la tabla de resultados.
    const total = await rows.count(); // Cuenta cuántos documentos se encontraron en la tabla.
    console.log(`🔎 ${total} comprobantes encontrados`);

    for (let i = 0; i < total; i++) { // Itera por cada fila hallada.
      const row = rows.nth(i); // Selecciona la fila actual por su índice.
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download'), // Prepara el recibidor de la descarga.
          row.locator('text=XML').click(), // Busca el enlace o botón que contenga el texto 'XML' dentro de la fila y le da clic.
        ]);
        const suggested = await download.suggestedFilename(); // Obtiene nombre sugerido.
        const filePath = path.join(DOWNLOAD_DIR, suggested || `comprobante-${i + 1}.xml`); // Genera ruta.
        await download.saveAs(filePath); // Persiste el archivo.
        console.log(`✅ XML descargado: ${filePath}`);
        await page.waitForTimeout(500); // Breve espera para no saturar las descargas.
      } catch (err) {
        console.log(`⚠️ Error en comprobante ${i + 1}:`, err.message || err);
      }
    }
  } catch (err) {
    console.log('⚠️ No se encontraron comprobantes o hubo un error:', err.message || err);
  }
}

/**
 * Función opcional para leer el contenido del XML descargado y extraer datos básicos.
 * Requiere la dependencia 'xml2js'.
 * @param {string} xmlPath - Ruta al archivo .xml.
 */
async function parsearXml(xmlPath) {
  try {
    const { parseStringPromise } = require('xml2js'); // Importa de forma dinámica el parser de XML a objeto JSON.
    const buf = fs.readFileSync(xmlPath); // Lee el archivo binario del disco.
    const data = await parseStringPromise(buf); // Convierte el texto XML a un objeto estructurado.
    const invoice = data?.Invoice || data; // Busca la raíz 'Invoice' (típica en facturas electrónicas).
    console.log('📄 ID Comprobante:', invoice?.['cbc:ID'] || '(no disponible)'); // Muestra el ID fiscal del documento.
  } catch (err) {
    console.log('ℹ️ parsearXml: xml2js no está disponible o hubo un error:', err.message || err);
  }
}

/**
 * Función principal (Orquestador) que inicia todo el flujo de automatización.
 */
async function main() {
  console.log('🚀 Iniciando automatización SUNAT...');
  // Lanza el navegador Chromium. headless: false permite ver la pantalla mientras ocurre el proceso.
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  // Crea un nuevo contexto (sesión limpia) con un tamaño de ventana amigable para el portal SUNAT.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(); // Abre una pestaña en blanco.

  try {
    const solPage = await loginSol(page); // Ejecuta el flujo de login y captura la página resultante.
    await aplicarManejoPopups(solPage); // Limpia popups invasivos iniciales.
    await irAComprobantes(solPage); // Navega hacia la sección de búsqueda de facturas.
    await consultarYLlenarForm(solPage); // Busca y descarga el documento específico.

    console.log('\n🎉 Proceso completado.');

    // Si la variable PAUSE_ON_END es 1, el navegador no se cerrará hasta que el usuario presione una tecla en consola.
    if (process.env.PAUSE_ON_END === '1') {
      console.log('Presiona ENTER para cerrar el navegador...');
      await new Promise((resolve) => process.stdin.once('data', resolve)); // Espera input del teclado.
    }
  } catch (err) {
    console.log('❌ Error en main:', err.message || err); // Captura fallos fatales en cualquier parte del flujo.
  } finally {
    await browser.close(); // Se asegura de apagar el motor del navegador al terminar (éxito o error).
  }
}

// Verifica si el script se está ejecutando directamente desde la consola para lanzar la función main.
if (require.main === module) {
  main();
}

