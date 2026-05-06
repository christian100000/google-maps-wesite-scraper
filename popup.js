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
            noWebsiteFilterLabel.style.display = 'none';
            resultSummary.style.display = 'none';
        }

        actionButton.addEventListener('click', function() {
            downloadCsvButton.disabled = true;
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

                if (!results || !results[0] || !results[0].result) {
                    resultSummary.textContent = 'No businesses found.';
                    return;
                }
                var scrapedItems = results[0].result;
                var visibleItems = noWebsiteFilter.checked
                    ? scrapedItems.filter(isNoWebsiteOrFacebookBusiness)
                    : scrapedItems;

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
                } else {
                    downloadCsvButton.disabled = true;
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

    });
});

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

    var hasStreetWord = /\b(via|viale|piazza|piazzale|corso|largo|strada|vicolo|localita|street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|square|sq\.?|plaza|rue|calle)\b/i.test(text);
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
            row.push('"' + cols[j].innerText + '"');
        }
        csv.push(row.join(','));
    }
    return csv.join('\n');
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
