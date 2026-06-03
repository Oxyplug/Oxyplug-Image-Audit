
# Oxyplug - Image Audit

This extension is used for SEO purposes. (Only images for now)




## Features

The extension will display the issues the images might have:
- Image load fails (404 or any other http status code other than 200)
- Image tag doesn't have src attribute
- Image tag doesn't have alt attribute
- Image tag's alt attribute length is more than X characters (X can be set in settings)
- Image tag doesn't have width/height attribute
- The rendered size of the image is different from the original size of the image
- The rendered aspect-ratio of the image is different from the original aspect-ratio of the image
- The image filesize is bigger than X (X can be set in settings)
- No 2x, 3x, ... set for the image
- The next-gen (WebP, AVIF) is not provided for the image
- The image doesn't have lazy="loading"
- Display which image is the LCP image
- The LCP image doesn't have lazy="eager"
- The LCP image is not preloaded
- The LCP image doesn't have decoding="sync"
## A Glance

![Oxyplug - Image Audit Demo](https://www.oxyplug.com/wp-content/uploads/2024/04/oxyplug-technical-seo-audit.png)
## Installation

- 1. Download the extension form here [Image Audit](https://www.oxyplug.com/wp-content/uploads/Technical-SEO-Audit.crx)
- 2. Open your Chrome browser.
- 3. Go to extensions page or enter `chrome://extensions` in your address bar and hit enter.
- 4. Drag and drop the downloaded extension to the extension page.
- 5. Hit the Extensions icon on top right corner of the browser and hit pin.
- 6. Navigate to the page you are going to audit.
- 7. Open the extension by hitting the extension icon (blue magnifier).
- 8. Hit Start to start auditing the page for the possible issues.
## Contributing

Contributions are always welcome!

