document.addEventListener('DOMContentLoaded', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        var currentTab = tabs[0];
        var actionButton = document.getElementById('actionButton');
        var downloadCsvButton = document.getElementById('downloadCsvButton');
        var resultsTable = document.getElementById('resultsTable');
        var filenameInput = document.getElementById('filenameInput');
        var noWebsiteFilter = document.getElementById('noWebsiteFilter');
        var noWebsiteFilterLabel = document.getElementById('noWebsiteFilterLabel');
        var resultSummary = document.getElementById('resultSummary');
        var existingCsvInput = document.getElementById('existingCsvInput');
        var mergeCsvButton = document.getElementById('mergeCsvButton');
        var latestVisibleItems = [];
        var existingCsvItems = [];
        var existingCsvFileName = '';
        var hasExistingCsvLoaded = false;

        if (currentTab && currentTab.url.includes("://www.google.com/maps/search")) {
            document.getElementById('message').textContent = "Let's scrape Google Maps!";
            actionButton.disabled = false;
            actionButton.classList.add('enabled');
        } else {
            var messageElement = document.getElementById('message');
            messageElement.innerHTML = '';
            var linkElement = document.createElement('a');
            linkElement.href = 'https://www.google.com/maps/search/';
            linkElement.textContent = "Go to Google Maps Search.";
            linkElement.target = '_blank'; 
            messageElement.appendChild(linkElement);

            actionButton.style.display = 'none';
            downloadCsvButton.style.display = 'none';
            filenameInput.style.display = 'none';
            existingCsvInput.style.display = 'none';
            mergeCsvButton.style.display = 'none';
            noWebsiteFilterLabel.style.display = 'none';
            resultSummary.style.display = 'none';
        }

        actionButton.addEventListener('click', function() {
            downloadCsvButton.disabled = true;
            mergeCsvButton.disabled = true;
            latestVisibleItems = [];
            resultSummary.textContent = '';

            chrome.scripting.executeScript({
                target: {tabId: currentTab.id},
                function: scrapeData
            }, function(results) {
                while (resultsTable.firstChild) {
                    resultsTable.removeChild(resultsTable.firstChild);
                }

                // Define and add headers to the table
                const headers = ['Title', 'Rating', 'Reviews', 'Phone', 'Industry', 'Address', 'Website', 'Google Maps Link'];
                const headerRow = document.createElement('tr');
                headers.forEach(headerText => {
                    const header = document.createElement('th');
                    header.textContent = headerText;
                    headerRow.appendChild(header);
                });
                resultsTable.appendChild(headerRow);

                if (chrome.runtime.lastError) {
                    resultSummary.textContent = 'Scrape failed: ' + chrome.runtime.lastError.message;
                    return;
                }

                if (!results || !results[0] || !results[0].result) {
                    resultSummary.textContent = 'No businesses found.';
                    return;
                }
                var scrapedItems = results[0].result;
                var visibleItems = noWebsiteFilter.checked
                    ? scrapedItems.filter(isNoWebsiteOrFacebookBusiness)
                    : scrapedItems;
                latestVisibleItems = visibleItems;

                resultSummary.textContent = getResultSummary(scrapedItems.length, visibleItems.length, noWebsiteFilter.checked);

                // Add new results to the table
                visibleItems.forEach(function(item) {
                    var row = document.createElement('tr');
                    ['title', 'rating', 'reviewCount', 'phone', 'industry', 'address', 'companyUrl', 'href'].forEach(function(key) {
                        var cell = document.createElement('td');
                        
                        if (key === 'reviewCount' && item[key]) {
                            item[key] = item[key].replace(/\(|\)/g, ''); 
                        }
                        
                        cell.textContent = item[key] || ''; 
                        row.appendChild(cell);
                    });
                    resultsTable.appendChild(row);
                });

                if (visibleItems.length > 0) {
                    downloadCsvButton.disabled = false;
                    mergeCsvButton.disabled = !hasExistingCsvLoaded;
                } else {
                    downloadCsvButton.disabled = true;
                    mergeCsvButton.disabled = true;
                }
            });
        });

        downloadCsvButton.addEventListener('click', function() {
            var csv = tableToCsv(resultsTable); 
            var filename = filenameInput.value.trim();
            if (!filename) {
                filename = 'google-maps-data.csv'; 
            } else {
                filename = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.csv';
            }
            downloadCsv(csv, filename); 
        });

        existingCsvInput.addEventListener('change', function() {
            var file = existingCsvInput.files && existingCsvInput.files[0];
            existingCsvItems = [];
            existingCsvFileName = file ? file.name : '';
            hasExistingCsvLoaded = false;
            mergeCsvButton.disabled = true;

            if (!file) {
                return;
            }

            var reader = new FileReader();
            reader.onload = function(event) {
                existingCsvItems = csvToItems(event.target.result || '');
                hasExistingCsvLoaded = true;
                mergeCsvButton.disabled = latestVisibleItems.length === 0;
                resultSummary.textContent = existingCsvItems.length + ' existing businesses loaded from CSV.';
            };
            reader.onerror = function() {
                resultSummary.textContent = 'Could not read the selected CSV file.';
            };
            reader.readAsText(file);
        });

        mergeCsvButton.addEventListener('click', function() {
            var mergeResult = mergeBusinessItems(existingCsvItems, latestVisibleItems);
            var filename = getUpdatedCsvFilename(existingCsvFileName, filenameInput.value.trim());

            downloadCsv(itemsToCsv(mergeResult.items), filename);
            resultSummary.textContent = mergeResult.addedCount + ' new businesses added. ' + mergeResult.skippedCount + ' duplicates skipped.';
        });
    });
});

const CSV_HEADERS = ['Title', 'Rating', 'Reviews', 'Phone', 'Industry', 'Address', 'Website', 'Google Maps Link'];
const CSV_KEYS = ['title', 'rating', 'reviewCount', 'phone', 'industry', 'address', 'companyUrl', 'href'];

function csvToItems(csvText) {
    var rows = parseCsv(csvText.replace(/^\uFEFF/, ''));
    if (rows.length === 0) {
        return [];
    }

    var headers = rows[0].map(normalizeHeader);
    return rows.slice(1).map(function(row) {
        var item = {};

        CSV_KEYS.forEach(function(key, index) {
            var columnIndex = headers.indexOf(normalizeHeader(CSV_HEADERS[index]));
            item[key] = columnIndex === -1 ? '' : row[columnIndex] || '';
        });

        return item;
    }).filter(function(item) {
        return item.title || item.phone || item.address || item.href;
    });
}

function parseCsv(csvText) {
    var rows = [];
    var row = [];
    var value = '';
    var inQuotes = false;

    for (var i = 0; i < csvText.length; i++) {
        var char = csvText[i];
        var nextChar = csvText[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                value += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            row.push(value);
            value = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++;
            }
            row.push(value);
            if (row.some(function(cell) { return cell !== ''; })) {
                rows.push(row);
            }
            row = [];
            value = '';
        } else {
            value += char;
        }
    }

    row.push(value);
    if (row.some(function(cell) { return cell !== ''; })) {
        rows.push(row);
    }

    return rows;
}

function itemsToCsv(items) {
    var rows = [CSV_HEADERS].concat(items.map(function(item) {
        return CSV_KEYS.map(function(key) {
            return item[key] || '';
        });
    }));

    return '\uFEFF' + rows.map(function(row) {
        return row.map(escapeCsvValue).join(',');
    }).join('\n');
}

function mergeBusinessItems(existingItems, newItems) {
    var mergedItems = existingItems.slice();
    var seenKeys = new Set();
    var addedCount = 0;
    var skippedCount = 0;

    existingItems.forEach(function(item) {
        var key = getBusinessKey(item);
        if (key) {
            seenKeys.add(key);
        }
    });

    newItems.forEach(function(item) {
        var key = getBusinessKey(item);

        if (key && seenKeys.has(key)) {
            skippedCount++;
            return;
        }

        mergedItems.push(item);
        addedCount++;
        if (key) {
            seenKeys.add(key);
        }
    });

    return {
        items: mergedItems,
        addedCount: addedCount,
        skippedCount: skippedCount
    };
}

function getBusinessKey(item) {
    var mapsLink = normalizeUrl(item.href || '');
    if (mapsLink) {
        return 'maps:' + mapsLink;
    }

    var phone = normalizePhone(item.phone || '');
    var title = normalizeBusinessText(item.title || '');
    var address = normalizeBusinessText(item.address || '');

    if (phone && title) {
        return 'phone-title:' + phone + ':' + title;
    }

    if (title && address) {
        return 'title-address:' + title + ':' + address;
    }

    var website = normalizeUrl(item.companyUrl || '');
    if (website && title) {
        return 'website-title:' + website + ':' + title;
    }

    return title || phone || website;
}

function getUpdatedCsvFilename(existingFileName, typedFileName) {
    if (typedFileName) {
        return typedFileName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.csv';
    }

    if (!existingFileName) {
        return 'google-maps-data-updated.csv';
    }

    return existingFileName.replace(/\.csv$/i, '') + '-updated.csv';
}

function normalizeHeader(value) {
    return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeBusinessText(value) {
    return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizePhone(value) {
    return (value || '').replace(/\D/g, '');
}

function normalizeUrl(value) {
    var url = (value || '').trim();

    if (!url) {
        return '';
    }

    try {
        var parsed = new URL(url);
        parsed.hash = '';
        parsed.search = '';
        return parsed.toString().replace(/\/$/, '').toLowerCase();
    } catch (error) {
        return url.split(/[?#]/)[0].replace(/\/$/, '').toLowerCase();
    }
}

function escapeCsvValue(value) {
    var text = String(value || '');
    return '"' + text.replace(/"/g, '""') + '"';
}
function isNoWebsiteOrFacebookBusiness(item) {
    var website = (item.companyUrl || '').trim();
    return !website || isFacebookUrl(website);
}

function isFacebookUrl(url) {
    try {
        var hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        return hostname === 'facebook.com' || hostname.endsWith('.facebook.com') || hostname === 'fb.com';
    } catch (error) {
        return /(^|\.)facebook\.com|fb\.com/i.test(url);
    }
}

function getResultSummary(totalCount, visibleCount, isFiltered) {
    if (!isFiltered) {
        return totalCount + ' businesses scraped.';
    }

    return visibleCount + ' of ' + totalCount + ' businesses have no website or use Facebook.';
}

function getCleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function getTextParts(container) {
    var text = container ? container.innerText || container.textContent || '' : '';
    return text
        .split(/\s*[\u00b7\u2022]\s*|\n+/)
        .map(getCleanText)
        .filter(Boolean);
}

function extractRatingAndReviews(container) {
    var rating = '';
    var reviewCount = '';

    if (!container) {
        return { rating: rating, reviewCount: reviewCount };
    }

    var ratingElement = container.querySelector('.MW4etd');
    if (ratingElement) {
        rating = getCleanText(ratingElement.textContent);
    }

    var reviewElement = container.querySelector('.UY7F9');
    if (reviewElement) {
        reviewCount = getCleanText(reviewElement.textContent).replace(/[()]/g, '');
    }

    if (rating && reviewCount) {
        return { rating: rating, reviewCount: reviewCount };
    }

    var labelledRating = Array.from(container.querySelectorAll('[aria-label]')).find(function(element) {
        return /star|stelle|\u00e9toile|estrella|stern|recension|review/i.test(element.getAttribute('aria-label') || '');
    });
    var label = labelledRating ? labelledRating.getAttribute('aria-label') || '' : '';

    if (!rating) {
        var ratingMatch = label.match(/(\d+(?:[,.]\d+)?)/);
        rating = ratingMatch ? ratingMatch[1] : '';
    }

    if (!reviewCount) {
        var reviewMatch = label.match(/(?:star|stars|stelle|\u00e9toile|\u00e9toiles|estrella|estrellas|stern)[^\d]*([\d.,]+)/i)
            || label.match(/([\d.,]+)\s*(?:review|reviews|recensioni|recension|avis|resenas|rese\u00f1as|bewertungen)/i);
        reviewCount = reviewMatch ? reviewMatch[1] : '';
    }

    return { rating: rating, reviewCount: reviewCount };
}

function extractPhone(container) {
    var phoneLabel = findLabelValue(container, /^(phone|telefono|call|chiama):?\s*/i);
    if (phoneLabel) {
        return phoneLabel;
    }

    var text = getCleanText(container ? container.innerText || container.textContent : '');
    var phoneMatch = text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{2,4}/);

    if (!phoneMatch) {
        return '';
    }

    var phone = getCleanText(phoneMatch[0]);
    var digits = phone.replace(/\D/g, '');
    return digits.length >= 7 ? phone : '';
}

function extractAddress(container, phone, rating, reviewCount) {
    var addressLabel = findLabelValue(container, /^(address|indirizzo):?\s*/i);
    if (addressLabel) {
        return addressLabel;
    }

    var parts = getTextParts(container);
    var addressPart = parts.find(function(part) {
        return isLikelyAddress(part, phone, rating, reviewCount);
    });

    return addressPart || '';
}

function findLabelValue(container, labelRegex) {
    if (!container || !container.querySelectorAll) {
        return '';
    }

    var labelledElement = Array.from(container.querySelectorAll('[aria-label]')).find(function(element) {
        return labelRegex.test(element.getAttribute('aria-label') || '');
    });
    var label = labelledElement ? labelledElement.getAttribute('aria-label') || '' : '';

    return getCleanText(label.replace(labelRegex, ''));
}

function isLikelyAddress(value, phone, rating, reviewCount) {
    var text = getCleanText(value);

    if (!text || text === phone || text === rating || text === reviewCount) {
        return false;
    }

    if (/\d+(?:[,.]\d+)?\s*(?:star|stelle|review|reviews|recensioni|recension)/i.test(text)) {
        return false;
    }

    if (/^(open|closed|aperto|chiuso|opens|closes|closing|hours|24 hours)\b/i.test(text)) {
        return false;
    }

    if (/^(website|directions|save|share|call|menu|order|prenota|indicazioni|salva|condividi|chiama)$/i.test(text)) {
        return false;
    }

    var foundPhone = extractPhone({ innerText: text });
    if (foundPhone && foundPhone === text) {
        return false;
    }

    var hasStreetWord = /\b(via|viale|piazza|piazzale|corso|largo|salita|strada|vicolo|localita|street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|square|sq\.?|plaza|rue|calle)\b/i.test(text);
    var hasAddressNumber = /\d/.test(text);
    var hasPostalCode = /\b\d{5}\b/.test(text);

    return (hasStreetWord && hasAddressNumber) || hasPostalCode;
}

function isGoogleMapsPlaceUrl(url) {
    return /(^|\/)maps\/place\//i.test(url || '');
}

function getPlaceResultEntries() {
    var links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
    var entries = [];
    var seenContainers = new Set();
    var seenLinks = new Set();

    links.forEach(function(link) {
        var container = link.closest('[jsaction*="mouseover:pane"], .Nv2PK, [role="article"]');
        var entryKey = container || link;
        var href = link.href || link.getAttribute('href') || '';

        if (seenContainers.has(entryKey) || seenLinks.has(href)) {
            return;
        }

        seenContainers.add(entryKey);
        seenLinks.add(href);
        entries.push({ link: link, container: container || link.closest('div') });
    });

    if (entries.length > 0) {
        return entries;
    }

    return Array.from(document.querySelectorAll('[jsaction*="mouseover:pane"], .Nv2PK, [role="article"]')).map(function(container) {
        return {
            link: container.querySelector('a[href*="/maps/place/"]'),
            container: container
        };
    });
}

function extractTitle(container, link) {
    var titleElement = container ? container.querySelector('.fontHeadlineSmall, .qBF1Pd, [role="heading"]') : null;
    var title = titleElement ? titleElement.textContent : '';

    if (!title && link) {
        title = link.getAttribute('aria-label') || link.textContent || '';
    }

    return getCleanText(title);
}


function scrapeData() {
    function getCleanText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    function getTextParts(container) {
        var text = container ? container.innerText || container.textContent || '' : '';
        return text
            .split(/\s*[\u00b7\u2022]\s*|\n+/)
            .map(getCleanText)
            .filter(Boolean);
    }

    function findLabelValue(container, labelRegex) {
        if (!container || !container.querySelectorAll) {
            return '';
        }

        var labelledElement = Array.from(container.querySelectorAll('[aria-label]')).find(function(element) {
            return labelRegex.test(element.getAttribute('aria-label') || '');
        });
        var label = labelledElement ? labelledElement.getAttribute('aria-label') || '' : '';

        return getCleanText(label.replace(labelRegex, ''));
    }

    function extractRatingAndReviews(container) {
        var rating = '';
        var reviewCount = '';

        if (!container) {
            return { rating: rating, reviewCount: reviewCount };
        }

        var ratingElement = container.querySelector('.MW4etd');
        if (ratingElement) {
            rating = getCleanText(ratingElement.textContent);
        }

        var reviewElement = container.querySelector('.UY7F9');
        if (reviewElement) {
            reviewCount = getCleanText(reviewElement.textContent).replace(/[()]/g, '');
        }

        if (rating && reviewCount) {
            return { rating: rating, reviewCount: reviewCount };
        }

        var labelledRating = Array.from(container.querySelectorAll('[aria-label]')).find(function(element) {
            return /star|stelle|\u00e9toile|estrella|stern|recension|review/i.test(element.getAttribute('aria-label') || '');
        });
        var label = labelledRating ? labelledRating.getAttribute('aria-label') || '' : '';

        if (!rating) {
            var ratingMatch = label.match(/(\d+(?:[,.]\d+)?)/);
            rating = ratingMatch ? ratingMatch[1] : '';
        }

        if (!reviewCount) {
            var reviewMatch = label.match(/(?:star|stars|stelle|\u00e9toile|\u00e9toiles|estrella|estrellas|stern)[^\d]*([\d.,]+)/i)
                || label.match(/([\d.,]+)\s*(?:review|reviews|recensioni|recension|avis|resenas|rese\u00f1as|bewertungen)/i);
            reviewCount = reviewMatch ? reviewMatch[1] : '';
        }

        return { rating: rating, reviewCount: reviewCount };
    }

    function extractPhone(container) {
        var phoneLabel = findLabelValue(container, /^(phone|telefono|call|chiama):?\s*/i);
        if (phoneLabel) {
            return phoneLabel;
        }

        var text = getCleanText(container ? container.innerText || container.textContent : '');
        var phoneMatch = text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{2,4}/);

        if (!phoneMatch) {
            return '';
        }

        var phone = getCleanText(phoneMatch[0]);
        var digits = phone.replace(/\D/g, '');
        return digits.length >= 7 ? phone : '';
    }

    function extractAddress(container, phone, rating, reviewCount) {
        var addressLabel = findLabelValue(container, /^(address|indirizzo):?\s*/i);
        if (addressLabel) {
            return addressLabel;
        }

        var parts = getTextParts(container);
        var addressPart = parts.find(function(part) {
            return isLikelyAddress(part, phone, rating, reviewCount);
        });

        return addressPart || '';
    }

    function isLikelyAddress(value, phone, rating, reviewCount) {
        var text = getCleanText(value);

        if (!text || text === phone || text === rating || text === reviewCount) {
            return false;
        }

        if (/\d+(?:[,.]\d+)?\s*(?:star|stelle|review|reviews|recensioni|recension)/i.test(text)) {
            return false;
        }

        if (/^(open|closed|aperto|chiuso|opens|closes|closing|hours|24 hours)\b/i.test(text)) {
            return false;
        }

        if (/^(website|directions|save|share|call|menu|order|prenota|indicazioni|salva|condividi|chiama)$/i.test(text)) {
            return false;
        }

        var foundPhone = extractPhone({ innerText: text });
        if (foundPhone && foundPhone === text) {
            return false;
        }

        var hasStreetWord = /\b(via|viale|piazza|piazzale|corso|largo|salita|strada|vicolo|localita|street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|square|sq\.?|plaza|rue|calle)\b/i.test(text);
        var hasAddressNumber = /\d/.test(text);
        var hasPostalCode = /\b\d{5}\b/.test(text);

        return (hasStreetWord && hasAddressNumber) || hasPostalCode;
    }

    function isGoogleMapsPlaceUrl(url) {
        return /(^|\/)maps\/place\//i.test(url || '');
    }

    function getPlaceResultEntries() {
        var links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
        var entries = [];
        var seenContainers = new Set();
        var seenLinks = new Set();

        links.forEach(function(link) {
            var container = link.closest('[jsaction*="mouseover:pane"], .Nv2PK, [role="article"]');
            var entryKey = container || link;
            var href = link.href || link.getAttribute('href') || '';

            if (seenContainers.has(entryKey) || seenLinks.has(href)) {
                return;
            }

            seenContainers.add(entryKey);
            seenLinks.add(href);
            entries.push({ link: link, container: container || link.closest('div') });
        });

        if (entries.length > 0) {
            return entries;
        }

        return Array.from(document.querySelectorAll('[jsaction*="mouseover:pane"], .Nv2PK, [role="article"]')).map(function(container) {
            return {
                link: container.querySelector('a[href*="/maps/place/"]'),
                container: container
            };
        });
    }

    function extractTitle(container, link) {
        var titleElement = container ? container.querySelector('.fontHeadlineSmall, .qBF1Pd, [role="heading"]') : null;
        var title = titleElement ? titleElement.textContent : '';

        if (!title && link) {
            title = link.getAttribute('aria-label') || link.textContent || '';
        }

        return getCleanText(title);
    }

    var entries = getPlaceResultEntries();
    return entries.map(entry => {
        var link = entry.link;
        var container = entry.container;
        var titleText = extractTitle(container, link);
        var rating = '';
        var reviewCount = '';
        var phone = '';
        var industry = '';
        var address = '';
        var companyUrl = '';

        // Rating and Reviews
        var ratingData = extractRatingAndReviews(container);
        rating = ratingData.rating;
        reviewCount = ratingData.reviewCount;

        // Phone Numbers
        phone = extractPhone(container);

        // Address and Industry
        if (container) {
            var containerText = container.textContent || '';
            address = extractAddress(container, phone, rating, reviewCount);

            if (address) {
                // Extract industry text based on the position before the address
                var textBeforeAddress = containerText.substring(0, containerText.indexOf(address)).trim();
                var ratingIndex = textBeforeAddress.lastIndexOf(rating + reviewCount);
                if (ratingIndex !== -1) {
                    // Assuming industry is the first significant text after rating and review count
                    var rawIndustryText = textBeforeAddress.substring(ratingIndex + (rating + reviewCount).length).trim().split(/[\r\n]+/)[0];
                    industry = rawIndustryText.replace(/[\u00b7.,#!?]/g, '').trim();
                }
            }
        }

        // Company URL
        if (container) {
            var allLinks = Array.from(container.querySelectorAll('a[href]'));
            var filteredLinks = allLinks.filter(a => !isGoogleMapsPlaceUrl(a.href));
            if (filteredLinks.length > 0) {
                companyUrl = filteredLinks[0].href;
            }
        }

        // Return the data as an object
        return {
            title: titleText,
            rating: rating,
            reviewCount: reviewCount,
            phone: phone,
            industry: industry,
            address: address,
            companyUrl: companyUrl,
            href: link ? link.href : '',
        };
    }).filter(function(item) {
        return item.title || item.href;
    });
}

// Convert the table to a CSV string
function tableToCsv(table) {
    var csv = [];
    var rows = table.querySelectorAll('tr');
    
    for (var i = 0; i < rows.length; i++) {
        var row = [], cols = rows[i].querySelectorAll('td, th');
        
        for (var j = 0; j < cols.length; j++) {
            row.push(escapeCsvValue(cols[j].innerText));
        }
        csv.push(row.join(','));
    }
    return '\uFEFF' + csv.join('\n');
}

// Download the CSV file
function downloadCsv(csv, filename) {
    var csvFile;
    var downloadLink;

    csvFile = new Blob([csv], {type: 'text/csv'});
    downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
}
