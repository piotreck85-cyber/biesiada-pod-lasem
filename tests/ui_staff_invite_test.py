"""Playwright UI test for Staff Email Invitation feature (iteration 20).
Runs against Expo web preview at EXPO_PUBLIC_BACKEND_URL.
"""
import asyncio
import os
import re
from playwright.async_api import async_playwright

BASE_URL = "https://event-profit-tracker.preview.emergentagent.com"
INVITE_EMAIL = "biesiadapodlasem+ui-test@gmail.com"
STAFF_NAME = "Test Invite UI"

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 390, "height": 844})
        # Auto-accept window.confirm dialogs for cancel flow
        page = await context.new_page()

        dialog_msgs = []
        async def _handle_dialog(dialog):
            dialog_msgs.append(dialog.message)
            print(f"CONFIRM DIALOG: {dialog.message}")
            await dialog.accept()
        page.on("dialog", _handle_dialog)
        page.on("console", lambda msg: print(f"CONSOLE[{msg.type}]: {msg.text}") if msg.type in ("error","warning") else None)

        results = {}
        created_staff_id = None
        try:
            # 1. LOGIN
            print("\n=== STEP 1: LOGIN ===")
            await page.goto(BASE_URL, wait_until="domcontentloaded")
            await page.wait_for_selector('[data-testid="login-email-input"]', timeout=30000)
            await page.fill('[data-testid="login-email-input"]', "test@eventa.pl")
            await page.fill('[data-testid="login-password-input"]', "test123")
            await page.click('[data-testid="login-submit-button"]', force=True)
            await page.wait_for_timeout(3000)
            results["login"] = "ok"
            print("Login submitted")

            # 2. Navigate to Zespół (pracownicy) tab
            print("\n=== STEP 2: NAVIGATE TO PRACOWNICY ===")
            # Try tab bar
            try:
                # tabs are in the (tabs) group, try direct URL navigation
                await page.goto(f"{BASE_URL}/pracownicy", wait_until="domcontentloaded")
                await page.wait_for_timeout(2500)
            except Exception as e:
                print(f"Nav via URL failed: {e}")

            # Verify add-staff-btn is present
            await page.wait_for_selector('[data-testid="add-staff-btn"]', timeout=15000)
            print("On pracownicy screen (add-staff-btn found)")
            results["nav_pracownicy"] = "ok"

            # 3. Create new staff member
            print("\n=== STEP 3: CREATE STAFF ===")
            await page.click('[data-testid="add-staff-btn"]', force=True)
            await page.wait_for_selector('[data-testid="staff-name-input"]', timeout=8000)
            await page.fill('[data-testid="staff-name-input"]', STAFF_NAME)
            await page.fill('[data-testid="staff-role-input"]', "Kelner")
            await page.click('[data-testid="staff-save-btn"]', force=True)
            await page.wait_for_timeout(2500)
            # Find the newly-created row (search by text)
            row = page.get_by_text(STAFF_NAME).first
            await row.wait_for(timeout=8000)
            # Get testid of parent row to extract id
            staff_row = await page.query_selector(f'[data-testid^="staff-row-"]:has-text("{STAFF_NAME}")')
            if staff_row is None:
                # try locating via evaluate
                staff_row_handle = await page.evaluate_handle(f"""
                    Array.from(document.querySelectorAll('[data-testid^="staff-row-"]')).find(el => el.textContent && el.textContent.includes("{STAFF_NAME}"))
                """)
                staff_row = staff_row_handle.as_element()
            tid = await staff_row.get_attribute("data-testid") if staff_row else None
            created_staff_id = tid.replace("staff-row-", "") if tid else None
            print(f"Created staff row testid = {tid}, id={created_staff_id}")
            results["create_staff"] = "ok" if created_staff_id else "fail"

            # 4. Open edit modal
            print("\n=== STEP 4: OPEN EDIT MODAL ===")
            await staff_row.click(force=True)
            await page.wait_for_timeout(1500)
            # verify KONTO PRACOWNIKA section and "Nie zaproszony" text
            body_text = await page.evaluate("() => document.body.innerText")
            assert "KONTO PRACOWNIKA" in body_text, "KONTO PRACOWNIKA section missing"
            assert "Nie zaproszony" in body_text, "'Nie zaproszony' status missing"
            print("Status text 'Nie zaproszony' present.")
            # Verify invite-send-btn present
            assert await page.is_visible('[data-testid="invite-send-btn"]'), "invite-send-btn not visible"
            # Verify existing manual login UI still present (Utwórz login button + UPRAWNIENIA)
            assert "UPRAWNIENIA PRACOWNIKA" in body_text, "UPRAWNIENIA section missing"
            assert "Utwórz login" in body_text, "Utwórz login button missing"
            results["initial_status"] = "ok"

            # 5. Fill invite email + click send
            print("\n=== STEP 5: FILL EMAIL + SEND INVITE ===")
            # Find loginEmail TextInput (placeholder "email pracownika")
            email_input = page.locator('input[placeholder="email pracownika"]').first
            await email_input.wait_for(timeout=5000)
            await email_input.fill(INVITE_EMAIL)
            await page.wait_for_timeout(300)
            await page.click('[data-testid="invite-send-btn"]', force=True)
            # Wait for backend response (real SMTP) - can take a few seconds
            await page.wait_for_timeout(7000)
            body_text = await page.evaluate("() => document.body.innerText")
            # The Alert.alert on web renders as native dialog handled above OR toast
            # Verify status changed
            has_sent = "Zaproszenie wysłane" in body_text
            has_email_shown = INVITE_EMAIL in body_text
            has_wazne = "Ważne do" in body_text
            print(f"'Zaproszenie wysłane' present: {has_sent}")
            print(f"Email shown in status: {has_email_shown}")
            print(f"'Ważne do' present: {has_wazne}")
            # invite-send-btn should be gone; resend + cancel visible
            send_visible = await page.is_visible('[data-testid="invite-send-btn"]')
            resend_visible = await page.is_visible('[data-testid="invite-resend-btn"]')
            cancel_visible = await page.is_visible('[data-testid="invite-cancel-btn"]')
            print(f"send-btn still visible: {send_visible} (should be False)")
            print(f"resend-btn visible: {resend_visible} (should be True)")
            print(f"cancel-btn visible: {cancel_visible} (should be True)")
            results["send_invite"] = {
                "status_sent_text": has_sent, "email_shown": has_email_shown, "wazne_do": has_wazne,
                "send_hidden": not send_visible, "resend_visible": resend_visible, "cancel_visible": cancel_visible
            }
            await page.screenshot(path="/app/test_reports/ui_iter20_invite_sent.jpeg", quality=40, full_page=False)

            # 6. Click resend
            print("\n=== STEP 6: RESEND INVITE ===")
            if resend_visible:
                await page.click('[data-testid="invite-resend-btn"]', force=True)
                await page.wait_for_timeout(7000)
                body_text = await page.evaluate("() => document.body.innerText")
                still_sent = "Zaproszenie wysłane" in body_text
                results["resend"] = "ok" if still_sent else "no-status"
                print(f"After resend, status still 'Zaproszenie wysłane': {still_sent}")

            # 7. Click cancel
            print("\n=== STEP 7: CANCEL INVITE ===")
            if cancel_visible:
                await page.click('[data-testid="invite-cancel-btn"]', force=True)
                await page.wait_for_timeout(3000)
                body_text = await page.evaluate("() => document.body.innerText")
                back_to_none = "Nie zaproszony" in body_text
                send_reappeared = await page.is_visible('[data-testid="invite-send-btn"]')
                print(f"Confirm dialog captured: {dialog_msgs}")
                print(f"Back to 'Nie zaproszony': {back_to_none}")
                print(f"invite-send-btn reappeared: {send_reappeared}")
                results["cancel"] = {"nie_zaproszony": back_to_none, "send_reappeared": send_reappeared, "dialog_msgs": dialog_msgs}
                await page.screenshot(path="/app/test_reports/ui_iter20_after_cancel.jpeg", quality=40, full_page=False)

            # 8. Persistence: close & reopen modal
            print("\n=== STEP 8: PERSISTENCE CHECK ===")
            # Close modal via pressing Escape or backdrop
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(1000)
            # Find row again & reopen
            staff_row2 = await page.query_selector(f'[data-testid="staff-row-{created_staff_id}"]')
            if staff_row2:
                await staff_row2.click(force=True)
                await page.wait_for_timeout(2000)
                body_text = await page.evaluate("() => document.body.innerText")
                persisted = "Nie zaproszony" in body_text
                print(f"After reopen, status 'Nie zaproszony' persisted: {persisted}")
                results["persistence"] = "ok" if persisted else "fail"

            # 9. Verify backend activation page for invalid token
            print("\n=== STEP 9: ACTIVATION PAGE (INVALID TOKEN) ===")
            new_page = await context.new_page()
            resp = await new_page.goto(f"{BASE_URL}/api/invitations/some-invalid-token/activate", wait_until="domcontentloaded")
            print(f"Activation page status: {resp.status if resp else 'no response'}")
            html_text = await new_page.evaluate("() => document.body.innerText")
            has_niewazne = "Zaproszenie jest nieważne" in html_text or "nieważne" in html_text.lower()
            print(f"Contains 'Zaproszenie jest nieważne': {has_niewazne}")
            print(f"Page text preview: {html_text[:300]}")
            await new_page.screenshot(path="/app/test_reports/ui_iter20_activation_invalid.jpeg", quality=40, full_page=False)
            results["activation_invalid_page"] = {"status": resp.status if resp else None, "has_text": has_niewazne}
            await new_page.close()

            # 10. Cleanup delete staff
            print("\n=== STEP 10: DELETE STAFF ===")
            # Close modal
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(1000)
            delete_btn = await page.query_selector(f'[data-testid="staff-delete-{created_staff_id}"]')
            if delete_btn:
                await delete_btn.click(force=True)
                await page.wait_for_timeout(2000)
                body_text = await page.evaluate("() => document.body.innerText")
                still_present = STAFF_NAME in body_text
                results["delete"] = "ok" if not still_present else "still-present"
                print(f"After delete, staff still present: {still_present}")
            else:
                results["delete"] = "delete-btn-not-found"

        except Exception as e:
            print(f"ERROR: {e}")
            import traceback; traceback.print_exc()
            try:
                await page.screenshot(path="/app/test_reports/ui_iter20_failure.jpeg", quality=40, full_page=False)
            except Exception:
                pass
            results["error"] = str(e)
        finally:
            print("\n=== FINAL RESULTS ===")
            import json
            print(json.dumps(results, indent=2, default=str))
            await browser.close()

asyncio.run(run())
