#!/usr/bin/env python3
"""
Playwright automation script to download XML and CDR from SUNAT SEE-SOL (Consultas)

Usage:
  - Set environment variables: SUNAT_RUC, SUNAT_USER, SUNAT_PASS
  - Run:
      python3 backend/scripts/download_sunat_playwright.py \
        --start 2026-01-01 --end 2026-01-31 --serie F001 --correlativo 123456

Notes:
  - This script is intentionally configurable: edit the SELECTORS dict to match the SUNAT portal HTML,
    since SUNAT often changes structure and uses nested iframes.
  - It uses Playwright sync API and expects `playwright` installed and `playwright install` executed.

Caveats:
  - Do not hardcode credentials; use environment variables.
  - Adjust timeouts and selectors for reliability.
"""

import os
import argparse
import logging
from pathlib import Path
from typing import Optional, Tuple
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError
import time

# --- Configuration ---
# Update these selectors to match the real SUNAT page when you inspect it.
# They are intentionally generic placeholders. You must adapt them if the page differs.
SELECTORS = {
    # Login page selectors
    # Login inputs as per HTML snippet provided by user
    "login_ruc": "input#txtRuc",
    "login_user": "input#txtUsuario",
    "login_pass": "input#txtContrasena",
    "login_submit": "button#btnAceptar",

    # Navigation selectors after login (links or buttons)
    "nav_empresas": "a:has-text('Empresas')",
    "nav_comprobantes": "a:has-text('Comprobantes de Pago')",
    "nav_see_sol": "a:has-text('SEE SOL')",
    "nav_factura": "a:has-text('Factura Electrónica')",
    "nav_consultar": "a:has-text('Consultar Factura')",

    # Frame-level selector for the frame that contains the search form (used to find the right frame)
    # Anchor element inside the search frame (we'll find the iframe that contains the RUC field)
    # Try several anchors that may exist inside the search iframe
    "search_form_anchor": [
        "input[formcontrolname='rucEmisor']",
        "input[formcontrolname='serieComprobante']",
        "input[formcontrolname='numeroComprobante']",
        "p-dropdown[formcontrolname='tipoComprobanteI']",
    ],

    # Search inputs inside frame (serie/numero strategy based on provided HTML)
    "ruc_emisor": "input[formcontrolname='rucEmisor']",
    "tipo_comprobante": "p-dropdown[formcontrolname='tipoComprobanteI']",
    "serie_comprobante": "input[formcontrolname='serieComprobante']",
    "numero_comprobante": "input[formcontrolname='numeroComprobante']",
    "btn_buscar": "button.boton-primary:has-text('Consultar')",

    # Table and row selectors (inside result frame) - adjust if portal uses a specific class
    "results_table": "table",
    # row selector must allow matching serie and correlativo inside cells
    "row_cells": "td",
    # inside a row, xml and cdr buttons (adjust to the actual structure)
    # Prefer attribute selector using the ngbtooltip text shown in the portal's buttons
    "btn_xml": "button[ngbtooltip='Descargar XML']",
    "btn_cdr": "button[ngbtooltip='Descargar CDR']",
}

# These constants may be changed by CLI arguments too
DEFAULT_RETRIES = 5
DEFAULT_TIMEOUT = 30000  # ms for Playwright waits

log = logging.getLogger("sunat_downloader")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def find_frame_by_anchor(page, anchor_selector, timeout: int = DEFAULT_TIMEOUT):
    """Search recursively for a frame that contains one of the anchor_selector elements.
    anchor_selector may be a string or a list of strings. Returns the frame object or None.
    """
    anchors = anchor_selector if isinstance(anchor_selector, (list, tuple)) else [anchor_selector]

    # First try the main page for any anchor
    for sel in anchors:
        try:
            page.wait_for_selector(sel, timeout=2000)
            log.debug(f"Anchor '{sel}' found on main page")
            return page.main_frame
        except Exception:
            continue

    # Search all frames
    for frame in page.frames:
        for sel in anchors:
            try:
                frame.wait_for_selector(sel, timeout=2000)
                log.debug(f"Found anchor '{sel}' in frame {frame.name}")
                return frame
            except Exception:
                continue
    return None


def click_and_download(frame, click_selector: str, download_dir: Path, filename: Path, timeout: int = DEFAULT_TIMEOUT) -> bool:
    """Click selector inside the given frame and wait for download. Save to filename.
    Returns True if download succeeded.
    """
    with frame.context.expect_download(timeout=timeout) as download_info:
        frame.click(click_selector, timeout=timeout)
    try:
        download = download_info.value
        target = filename
        download.save_as(str(target))
        log.info(f"Saved download to {target}")
        return True
    except Exception as e:
        log.warning(f"Download failed or timed out: {e}")
        return False


def search_row_by_serie_correlativo(frame, serie: str, correlativo: str) -> Optional[object]:
    """Return the locator for the row matching serie and correlativo, or None.
    The strategy: iterate rows and inspect text cells.
    """
    try:
        table = frame.locator(SELECTORS['results_table'])
        # wait for table
        table.wait_for(timeout=DEFAULT_TIMEOUT)
    except PWTimeoutError:
        log.info("Results table not found in frame")
        return None
    rows = table.locator('tbody tr')
    count = rows.count()
    log.debug(f"Found {count} rows in results table")
    for i in range(count):
        row = rows.nth(i)
        text = row.inner_text()
        if serie in text and correlativo in text:
            log.info(f"Found matching row at index {i}")
            return row
    return None


def run_download(
    start_date: str,
    end_date: str,
    serie: str,
    correlativo: str,
    tipo: str,
    download_dir: str,
    headless: bool,
    retries: int,
    timeout_ms: int,
    selectors: dict,
    playwright_proxy: Optional[str] = None,
) -> bool:
    download_path = Path(download_dir)
    download_path.mkdir(parents=True, exist_ok=True)

    RUC = os.getenv('SUNAT_RUC')
    USER = os.getenv('SUNAT_USER')
    PASS = os.getenv('SUNAT_PASS')
    if not (RUC and USER and PASS):
        log.error("Environment variables SUNAT_RUC, SUNAT_USER and SUNAT_PASS are required")
        return False

    # URL: you may need to update this to the actual entry point for Mis trámites y consultas
    LOGIN_URL = os.getenv('SUNAT_LOGIN_URL', 'https://www.sunat.gob.pe/')

    opts = {}
    if playwright_proxy:
        opts['proxy'] = {'server': playwright_proxy}

    with sync_playwright() as p:
        # Improve the browser fingerprint to avoid headless-only content differences
        launch_args = [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
        ]
        browser = p.chromium.launch(headless=headless, args=launch_args)
        ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        context = browser.new_context(accept_downloads=True, user_agent=ua, viewport={'width':1280, 'height':900})
        page = context.new_page()
        page.set_default_timeout(timeout_ms)

        log.info("Opening login page")
        page.goto(LOGIN_URL)

        # --- LOGIN ---
        try:
            log.info("Filling login form")
            # Try to find the login fields inside any frame first
            login_frame = None
            try:
                login_frame = find_frame_by_anchor(page, selectors.get('login_user') or selectors.get('login_ruc'))
            except Exception:
                login_frame = None

            # If login inputs are not present on the landing page, try to follow a SOL login link
            if not login_frame:
                try:
                    # common anchors that lead to SOL auth
                    sol_link = page.locator("a[href*='loginMenuSol'], a[href*='SignOnVerification'], a[href*='clientessol']")
                    if sol_link.count() > 0:
                        log.info('Found SOL login link on page; navigating to auth flow')
                        # the auth flow may open in a new page; capture it if so
                        try:
                            with context.expect_page() as new_page_info:
                                sol_link.first.click()
                            new_page = new_page_info.value
                            new_page.wait_for_load_state('networkidle')
                            page = new_page
                        except Exception:
                            # fallback: click and reuse same page
                            sol_link.first.click()
                            page.wait_for_load_state('networkidle')

                        # try again to find login frame/inputs
                        try:
                            login_frame = find_frame_by_anchor(page, selectors.get('login_user') or selectors.get('login_ruc'))
                        except Exception:
                            login_frame = None
                except Exception:
                    log.debug('No SOL login link found or click failed')

            target = login_frame or page

            # If login selector not found, try several candidate selectors as fallback
            LOGIN_CANDIDATES = [
                selectors.get('login_user'),
                "input#txtUsuario",
                "input#txtUser",
                "input[name='username']",
                "input[name='user']",
                "input[placeholder*='Usuario']",
            ]

            # Wait and fill RUC if present
            if selectors.get('login_ruc'):
                try:
                    target.wait_for_selector(selectors['login_ruc'], timeout=5000)
                    target.fill(selectors['login_ruc'], RUC)
                except Exception:
                    log.debug('RUC selector not found in login target; skipping')

            # Wait and fill user/pass
            # Try candidate selectors until one is found
            found_user_sel = None
            for cand in LOGIN_CANDIDATES:
                if not cand:
                    continue
                try:
                    target.wait_for_selector(cand, timeout=3000)
                    found_user_sel = cand
                    break
                except Exception:
                    continue

            if not found_user_sel:
                log.error("Login user input not found among candidates")
                # Save diagnostics
                dbg_dir = Path(download_dir) / 'debug'
                dbg_dir.mkdir(parents=True, exist_ok=True)
                screenshot_path = dbg_dir / 'login_page.png'
                html_path = dbg_dir / 'login_page.html'
                try:
                    page.screenshot(path=str(screenshot_path), full_page=True)
                    with open(html_path, 'w', encoding='utf-8') as f:
                        f.write(page.content())
                    log.info(f"Saved diagnostic screenshot to {screenshot_path} and html to {html_path}")
                except Exception as de:
                    log.warning(f"Could not save diagnostics: {de}")
                browser.close()
                return False

            # Fill the found selector
            try:
                target.fill(found_user_sel, USER)
            except Exception as e:
                log.error(f"Could not fill user selector {found_user_sel}: {e}")
                browser.close()
                return False

            try:
                target.wait_for_selector(selectors['login_pass'], timeout=5000)
                target.fill(selectors['login_pass'], PASS)
            except Exception:
                log.debug('Password input not found; continuing to submit if possible')

            # Submit login
            try:
                # prefer clicking submit selector
                target.click(selectors['login_submit'])
            except Exception:
                try:
                    target.keyboard.press('Enter')
                except Exception:
                    log.debug('Could not submit login via click or Enter')

            # Wait for navigation or some known post-login anchor
            page.wait_for_load_state('networkidle')
            log.info('Login submitted')

            # --- Post-login enhanced diagnostics ---
            # Save a screenshot and the full page HTML, and dump each frame's content (or outerHTML)
            try:
                dbg_dir = Path(download_dir) / 'debug'
                dbg_dir.mkdir(parents=True, exist_ok=True)
                post_screenshot = dbg_dir / 'post_login.png'
                post_html = dbg_dir / 'post_login.html'
                try:
                    page.screenshot(path=str(post_screenshot), full_page=True)
                except Exception:
                    log.debug('Could not take full page screenshot')
                try:
                    with open(post_html, 'w', encoding='utf-8') as f:
                        f.write(page.content())
                except Exception:
                    log.debug('Could not write post-login page HTML')

                # Dump each frame's content where possible
                for idx, fr in enumerate(page.frames):
                    frame_fname = dbg_dir / f'frame_{idx}_{(fr.name or "frame")}.html'
                    try:
                        # Prefer frame.content(), but some cross-origin frames may fail
                        try:
                            content = fr.content()
                        except Exception:
                            # fallback to evaluating outerHTML inside the frame
                            try:
                                content = fr.evaluate("() => document.documentElement.outerHTML")
                            except Exception:
                                content = f"<no retrievable content for frame name={fr.name} url={fr.url}>"
                    except Exception as e:
                        content = f"<error reading frame: {e}>"
                    try:
                        with open(frame_fname, 'w', encoding='utf-8') as fh:
                            fh.write(f"<!-- frame name={fr.name} url={fr.url} -->\n")
                            fh.write(str(content))
                    except Exception:
                        log.debug(f"Could not write frame dump for frame {idx}")
                log.info(f"Saved post-login debug files to {dbg_dir}")
            except Exception as de:
                log.warning(f"Could not write post-login diagnostics: {de}")
            # Try to dismiss any post-login notification that requires confirming/finalizing
            try:
                def click_finalize_notification(page_or_ctx):
                    """Attempt to click post-login notification buttons or invoke their onclick handlers.
                    Handles: Finalizar (#btnFinalizarValidacionDatos), Enviar código(s) (#btnContinuarIUO2Codigos),
                    and Continuar sin confirmar (#btnCerrar). Returns True if an action was taken.
                    """
                    # Helper to try id, text, and JS invocation for a button
                    def try_button_id_text(js_ctx, btn_id, text_matches=None, js_fn_invoke=None):
                        try:
                            if btn_id:
                                loc = js_ctx.locator(f"#{btn_id}")
                                if loc.count() > 0:
                                    try:
                                        loc.first.click(timeout=3000)
                                        log.info(f"Clicked #{btn_id}")
                                        return True
                                    except Exception:
                                        try:
                                            js_ctx.evaluate(f"() => document.getElementById('{btn_id}')?.click()")
                                            log.info(f"Invoked click on #{btn_id} via evaluate")
                                            return True
                                        except Exception:
                                            pass
                            if text_matches:
                                for txt in text_matches:
                                    try:
                                        loc2 = js_ctx.locator(f"button:has-text('{txt}')")
                                        if loc2.count() > 0:
                                            try:
                                                loc2.first.click(timeout=3000)
                                                log.info(f"Clicked button with text '{txt}'")
                                                return True
                                            except Exception:
                                                try:
                                                    js_ctx.evaluate("() => Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('" + txt + "'))?.click()")
                                                    log.info(f"Invoked click on button text '{txt}' via evaluate")
                                                    return True
                                                except Exception:
                                                    pass
                                    except Exception:
                                        continue
                            if js_fn_invoke:
                                try:
                                    invoked = js_ctx.evaluate("() => { try { if(typeof %s === 'function') { %s(); return true; } return false; } catch(e) { return false; } }" % (js_fn_invoke, js_fn_invoke))
                                    if invoked:
                                        log.info(f"Invoked {js_fn_invoke}() via evaluate")
                                        return True
                                except Exception:
                                    pass
                        except Exception:
                            pass
                        return False

                    # 1) Try Finalizar
                    if try_button_id_text(page_or_ctx, 'btnFinalizarValidacionDatos', text_matches=['Finalizar'], js_fn_invoke='callFinalizar'):
                        return True

                    # 2) Try Enviar código(s) de verificación
                    if try_button_id_text(page_or_ctx, 'btnContinuarIUO2Codigos', text_matches=['Enviar código(s) de verificación', 'Enviar código'], js_fn_invoke="EnviarIU03"):
                        return True

                    # 3) Try Registrar / Continuar flows
                    if try_button_id_text(page_or_ctx, 'btnContinuarIU02Registrar', text_matches=['Registrar datos', 'Registrar datos de contacto'], js_fn_invoke='ContinuarActaulizarDatosIU05'):
                        return True

                    # 4) Try Continuar sin confirmar (btnCerrar)
                    if try_button_id_text(page_or_ctx, 'btnCerrar', text_matches=['Continuar sin confirmar', 'Continuar'] , js_fn_invoke='callHide'):
                        return True

                    return False

                # First try on the main page
                try:
                    if click_finalize_notification(page):
                        time.sleep(0.5)
                except Exception:
                    log.debug('Could not click Finalizar on main page')

                # Then try each frame, in case the notification lives inside a frame
                for fr_check in page.frames:
                    try:
                        if click_finalize_notification(fr_check):
                            time.sleep(0.5)
                            break
                    except Exception:
                        continue
            except Exception:
                log.debug('Finalizar notification handling failed or not present')
        except Exception as e:
            log.error(f"Login failed: {e}")
            browser.close()
            return False

            # --- NAVIGATION ---
        # Try to click the navigation links; some may be replaced by direct navigation to a known URL
        try:
            for key in ('nav_empresas', 'nav_comprobantes', 'nav_see_sol', 'nav_factura', 'nav_consultar'):
                sel = selectors.get(key)
                if not sel:
                    continue
                # attempt click if present
                try:
                    page.wait_for_selector(sel, timeout=5000)
                    page.click(sel)
                    log.info(f'Clicked nav {key}')
                    page.wait_for_load_state('networkidle')
                except Exception:
                    log.debug(f'Nav selector {key} not found or not clickable')

        except Exception as e:
            log.warning(f"Navigation steps had issues: {e}")

            # Try to find and follow a direct link to the SOL e-menu service (commonly used href patterns)
            try:
                sol_service = page.locator("a[href*='cl-ti-itmenu'], a[href*='MenuInternet.htm'], a[href*='e-menu.sunat']")
                if sol_service.count() > 0:
                    log.info('Found link to SOL e-menu; navigating into service')
                    try:
                        with context.expect_page() as new_page_info:
                            sol_service.first.click()
                        new_page = new_page_info.value
                        new_page.wait_for_load_state('networkidle')
                        page = new_page
                    except Exception:
                        # fallback: click in same page
                        sol_service.first.click()
                        page.wait_for_load_state('networkidle')
                    # Save diagnostic HTML after entering SOL e-menu
                    try:
                        dbg_dir = Path(download_dir) / 'debug'
                        dbg_dir.mkdir(parents=True, exist_ok=True)
                        after_sol = dbg_dir / 'after_sol.html'
                        with open(after_sol, 'w', encoding='utf-8') as f:
                            f.write(page.content())
                        # list frames
                        frames_list = dbg_dir / 'frames_list.txt'
                        with open(frames_list, 'w', encoding='utf-8') as fl:
                            for idx, fr in enumerate(page.frames):
                                fl.write(f"frame[{idx}] name={fr.name} url={fr.url}\n")
                        log.info(f"Wrote SOL debug files: {after_sol} and {frames_list}")
                    except Exception as de:
                        log.warning(f"Could not write SOL debug files: {de}")
            except Exception:
                log.debug('No direct SOL e-menu link found on page')

        # Try to navigate inside the e-menu frame to the consultas/comprobantes area
        def try_navigate_emenu(page):
            """Look for the e-menu frame and click through likely navigation links to reveal the search UI."""
            emenu_frame = None
            for fr in page.frames:
                if 'e-menu.sunat.gob.pe' in (fr.url or '') or 'cl-ti-itmenu' in (fr.url or ''):
                    emenu_frame = fr
                    break
            if not emenu_frame:
                return False

            NAV_TEXT_CANDIDATES = [
                'Comprobantes',
                'Comprobantes de Pago',
                'Factura Electrónica',
                'Consultar Factura',
                'Consultar',
                'Consultas',
            ]

            for txt in NAV_TEXT_CANDIDATES:
                try:
                    loc = emenu_frame.locator(f"text= {txt}")
                    if loc.count() > 0:
                        try:
                            loc.first.click()
                            page.wait_for_load_state('networkidle')
                            log.info(f"Clicked e-menu nav link: {txt}")
                            return True
                        except Exception:
                            # try alternative: click any link containing the text
                            try:
                                emenu_frame.click(f"a:has-text('{txt}')", timeout=3000)
                                page.wait_for_load_state('networkidle')
                                log.info(f"Clicked e-menu a:has-text('{txt}')")
                                return True
                            except Exception:
                                continue
                except Exception:
                    continue
            return False

        # Attempt e-menu navigation to expose the search iframe
        try:
            navigated = try_navigate_emenu(page)
            if navigated:
                # small wait for dynamic content
                time.sleep(1)
        except Exception:
            log.debug('e-menu navigation attempts failed or not applicable')

        # Now we need to find the frame that contains the search form
        frame = find_frame_by_anchor(page, selectors['search_form_anchor'])
        if not frame:
            log.error("Could not locate the search frame. Update SELECTORS['search_form_anchor'] to an element inside the search iframe.")
            # Save debug HTML for all frames
            dbg_dir = Path(download_dir) / 'debug'
            dbg_dir.mkdir(parents=True, exist_ok=True)
            try:
                for idx, f in enumerate(page.frames):
                    try:
                        content = f.content()
                    except Exception:
                        content = '<no content>'
                    p = dbg_dir / f'frame_{idx}_{(f.name or "main")}.html'
                    with open(p, 'w', encoding='utf-8') as fh:
                        fh.write(content)
                log.info(f'Wrote frame debug HTML to {dbg_dir}')
            except Exception as de:
                log.warning(f'Could not write frame debug files: {de}')
            browser.close()
            return False

        # Fill search filters inside frame (using RUC, tipo, serie y número)
        try:
            log.info('Filling search form in frame')
            # RUC emisor
            try:
                frame.fill(selectors['ruc_emisor'], RUC)
            except Exception:
                log.debug('ruc_emisor selector not found or could not fill')

            # Tipo comprobante (custom dropdown component)
            try:
                # p-dropdown often requires clicking to open then selecting an option; try select_option first
                frame.select_option(selectors['tipo_comprobante'], value=tipo)
            except Exception:
                log.debug('tipo_comprobante select_option failed; trying click-to-open fallback')
                try:
                    dd = frame.locator(selectors['tipo_comprobante'])
                    dd.click()
                    # The actual option selector can vary; user should adapt if needed
                    option_sel = f"text=01" if tipo == '01' else f"text={tipo}"
                    frame.click(option_sel)
                except Exception:
                    log.debug('Fallback selection for tipo_comprobante failed')

            # Serie y número
            try:
                frame.fill(selectors['serie_comprobante'], serie)
                frame.fill(selectors['numero_comprobante'], correlativo)
            except Exception:
                log.debug('serie/numero selectors not found or could not fill')

            # Click Buscar/Consultar
            frame.click(selectors['btn_buscar'])
            # Wait for results to appear
            frame.wait_for_selector(selectors['results_table'], timeout=timeout_ms)
        except Exception as e:
            log.error(f"Search form interaction failed: {e}")
            browser.close()
            return False

        # Retry loop for locating row and downloading
        success = False
        for attempt in range(1, retries + 1):
            log.info(f"Search attempt {attempt}/{retries}")
            try:
                row = search_row_by_serie_correlativo(frame, serie, correlativo)
                if not row:
                    log.info("Row not found yet; waiting and retrying")
                    # Wait for a short while for results to populate
                    time.sleep(2)
                    continue

                # Found row: attempt downloads
                # Build filenames
                xml_fn = download_path / f"{serie}-{correlativo}.xml"
                cdr_fn = download_path / f"{serie}-{correlativo}.cdr"  # cdr may be zip or xml depending on site

                # Click XML button inside row; if button not present, try opening modal and use modal buttons
                try:
                    # Prefer using row.locator to scope the click
                    xml_button = row.locator(selectors['btn_xml'])
                    if xml_button.count() > 0:
                        with context.expect_download(timeout=timeout_ms) as d_xml:
                            xml_button.first.click()
                        dl = d_xml.value
                        dl.save_as(str(xml_fn))
                        log.info(f"Downloaded XML to {xml_fn}")
                    else:
                        log.info('XML button not found in row; attempting modal fallback')
                        try:
                            # click the row to open modal (modal markup provided by user)
                            row.click()
                            # wait for modal to appear on the page
                            page.locator('ngb-modal-window').wait_for(timeout=timeout_ms)
                            modal = page.locator('ngb-modal-window')
                            modal_xml = modal.locator("button[ngbtooltip='Descargar XML']")
                            if modal_xml.count() > 0:
                                with context.expect_download(timeout=timeout_ms) as d_xml2:
                                    modal_xml.first.click()
                                dl2 = d_xml2.value
                                dl2.save_as(str(xml_fn))
                                log.info(f"Downloaded XML from modal to {xml_fn}")
                            else:
                                log.warning('Modal XML button not found')
                        except Exception as me:
                            log.warning(f"Modal XML fallback failed: {me}")
                except Exception as e:
                    log.warning(f"XML download failed: {e}")

                # Click CDR button inside row; fallback to modal if needed
                try:
                    cdr_button = row.locator(selectors['btn_cdr'])
                    if cdr_button.count() > 0:
                        with context.expect_download(timeout=timeout_ms) as d_cdr:
                            cdr_button.first.click()
                        dl2 = d_cdr.value
                        dl2.save_as(str(cdr_fn))
                        log.info(f"Downloaded CDR to {cdr_fn}")
                    else:
                        log.info('CDR button not found in row; attempting modal fallback')
                        try:
                            # If modal already open from previous step, reuse it; otherwise open
                            modal = page.locator('ngb-modal-window')
                            try:
                                modal.wait_for(timeout=2000)
                            except Exception:
                                # modal may not be open yet; click row to open
                                row.click()
                                page.locator('ngb-modal-window').wait_for(timeout=timeout_ms)
                                modal = page.locator('ngb-modal-window')

                            modal_cdr = modal.locator("button[ngbtooltip='Descargar CDR']")
                            if modal_cdr.count() > 0:
                                with context.expect_download(timeout=timeout_ms) as d_cdr2:
                                    modal_cdr.first.click()
                                dl3 = d_cdr2.value
                                dl3.save_as(str(cdr_fn))
                                log.info(f"Downloaded CDR from modal to {cdr_fn}")
                            else:
                                log.warning('Modal CDR button not found')
                        except Exception as me2:
                            log.warning(f"Modal CDR fallback failed: {me2}")
                except Exception as e:
                    log.warning(f"CDR download failed: {e}")

                # If at least one file exists, mark success
                if xml_fn.exists() or cdr_fn.exists():
                    success = True
                    break
                else:
                    log.info('No files downloaded in this attempt; will retry')
                    time.sleep(2)

            except Exception as e:
                log.warning(f"Attempt {attempt} failed with error: {e}")
                time.sleep(2)
                continue

        browser.close()
        if success:
            log.info('Download completed successfully')
        else:
            log.error('Download failed or comprobante not found')
        return success


def main():
    parser = argparse.ArgumentParser(description='Download XML and CDR from SUNAT SEE-SOL using Playwright')
    parser.add_argument('--start', required=True, help='Start date YYYY-MM-DD')
    parser.add_argument('--end', required=True, help='End date YYYY-MM-DD')
    parser.add_argument('--serie', required=True, help='Series (e.g. F001)')
    parser.add_argument('--correlativo', required=True, help='Correlative number')
    parser.add_argument('--tipo', default='01', help='Tipo comprobante (01 = Factura)')
    parser.add_argument('--download-dir', default='downloads/sunat', help='Directory to save downloads')
    parser.add_argument('--headless', action='store_true', help='Run browser headless')
    parser.add_argument('--retries', type=int, default=DEFAULT_RETRIES, help='Number of retries for search/download')
    parser.add_argument('--timeout', type=int, default=DEFAULT_TIMEOUT, help='Playwright timeout in ms')
    args = parser.parse_args()

    success = run_download(
        start_date=args.start,
        end_date=args.end,
        serie=args.serie,
        correlativo=args.correlativo,
        tipo=args.tipo,
        download_dir=args.download_dir,
        headless=args.headless,
        retries=args.retries,
        timeout_ms=args.timeout,
        selectors=SELECTORS,
    )

    if success:
        print('SUCCESS: Files downloaded or found')
        exit(0)
    else:
        print('FAIL: Comprobante not found or downloads failed')
        exit(2)


if __name__ == '__main__':
    main()
