# security.txt Checker — User Guide

## Introduction

**security.txt Checker** is a lightweight Chrome extension that helps you quickly determine whether a website publishes a **security.txt** file.

A `security.txt` file (defined in RFC 9116) allows organizations to publish clear vulnerability disclosure information, such as:

* Security contact addresses
* Responsible disclosure policies
* Encryption keys
* Preferred languages
* Hiring information

This extension automatically checks the currently visited domain for a security.txt file and allows you to:

* See whether a security.txt exists
* View its contents directly from the browser
* Add custom endpoints in settings for non-standard deployments

The goal is to make responsible disclosure discovery fast and frictionless for security researchers, developers, and system administrators.

---

## Installation

### 1. Download or prepare the extension files

Ensure the extension folder contains at least:

```
securitytxt-checker/
├── manifest.json
├── service_worker.js
├── popup.html
├── popup.js
├── options.html
└── options.js
```

Icons are optional. If icons are referenced in the manifest, make sure they exist.

---

### 2. Enable Developer Mode in Chrome

1. Open Chrome.
2. Navigate to:

```
chrome://extensions
```

3. Enable **Developer mode** (top right).

---

### 3. Load the extension locally

1. Click **Load unpacked**.
2. Select the extension folder (`securitytxt-checker/`).
3. The extension will now appear in your extensions list.

If everything is correct, the extension icon becomes available in the toolbar.

---

## How It Works

When you visit a website:

1. The extension detects the active domain.
2. It tries to fetch a security.txt file using default endpoints:

```
https://domain/.well-known/security.txt
https://domain/security.txt
```

3. If found:

   * The extension badge shows **OK**.
4. If not found:

   * The badge shows **NO**.

The extension uses HTTPS by default, as recommended by RFC 9116.

---

## Using the Extension

### Opening the popup

Click the extension icon in your browser toolbar.

You will see:

* Current status (FOUND / NOT FOUND)
* Source URL (if found)
* Contents of the security.txt file
* Buttons:

  * **Recheck** — force a new check
  * **Settings** — open configuration page

---

### Reading the security.txt

If a file exists, the popup displays:

* The exact URL where it was found
* HTTP status code
* Raw file contents

This allows quick validation without opening developer tools or using curl.

---

## Settings (Adding Custom Endpoints)

Some organizations place their security.txt in non-standard locations.

You can add custom paths:

1. Open the popup.
2. Click **Settings**.
3. Add an endpoint path, for example:

```
/contact/security.txt
/security/security.txt
```

4. Click **Add**.

These paths will be checked in addition to the default locations.

---

## Badge Meanings

| Badge | Meaning                |
| ----- | ---------------------- |
| OK    | security.txt found     |
| NO    | security.txt not found |
| ?     | checking or loading    |

---

## Example Workflow (Security Research)

Typical usage:

1. Open a target domain.
2. Check extension badge.
3. If found:

   * Open popup
   * Review Contact or Policy fields
4. Use disclosure information for responsible reporting.

---

## Troubleshooting

### Extension does not load

* Check that all files referenced in `manifest.json` exist.
* Remove icon references if icons are missing.
* Reload the extension in `chrome://extensions`.

---

### Badge does not update

* Refresh the page.
* Click **Recheck** in the popup.
* Ensure the page uses HTTP or HTTPS.

---

### No security.txt found but you expect one

Possible reasons:

* File only available on another subdomain
* Redirect or authentication requirement
* Custom endpoint not configured

Add the endpoint manually in Settings.

---

## Security & Privacy

* The extension only performs GET requests to the currently visited domain.
* No data is sent to external servers.
* All processing happens locally in the browser.

---

## Future Improvements (Optional Ideas)

Possible enhancements:

* RFC syntax validation
* Highlight required fields (Contact, Expires, Policy)
* Quick-copy disclosure contact
* Compliance scoring
* Export to clipboard

---

## License

Use freely for research and educational purposes.

---

## Credits

Based on the security.txt standard defined in RFC 9116 and common responsible disclosure practices.
