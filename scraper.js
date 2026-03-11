class WebScraper {
    constructor() {
        this.gamesData = [];
        // Multiple CORS proxies to avoid blocking
        this.corsProxies = [
            'https://corsproxy.io/?',
            'https://api.allorigins.win/raw?url=',
            'https://cors-anywhere.herokuapp.com/',
            'https://proxy.cors.sh/',
            'https://thingproxy.freeboard.io/fetch/'
        ];
        
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        ];
    }

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    async fetchWithProxy(url) {
        for (let i = 0; i < this.corsProxies.length; i++) {
            try {
                const proxyUrl = this.corsProxies[i] + encodeURIComponent(url);
                const response = await fetch(proxyUrl, {
                    headers: {
                        'User-Agent': this.getRandomUserAgent(),
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5'
                    }
                });
                
                if (response.ok) {
                    const text = await response.text();
                    console.log(`✅ Fetched: ${url.substring(0, 50)}...`);
                    return text;
                }
            } catch (error) {
                console.log(`Proxy ${i} failed, trying next...`);
                await this.delay(1000);
            }
        }
        throw new Error('All proxies failed');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    cleanText(text) {
        if (!text) return "Not Available";
        return text.replace(/\s+/g, ' ').trim();
    }

    // ================== IMPROVED LINK EXTRACTION ==================
    extractGameLinks(html, baseUrl) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const links = new Set();

        // Find all article links – look for patterns that indicate a game article
        doc.querySelectorAll('a[href*="/"], a[class*="headline"], a[class*="title"]').forEach(a => {
            let href = a.getAttribute('href');
            if (!href) return;

            // Make absolute URL
            try {
                href = new URL(href, baseUrl).href;
            } catch (e) {
                return;
            }

            // Skip obvious non-article links
            const skipPatterns = [
                '/page/', '/category/', '#', 'javascript:', 
                'facebook.com', 'twitter.com', '/privacy', '/terms',
                '/games/', '/reviews/', '/features/', '/news/' // Skip category pages themselves
            ];
            if (skipPatterns.some(p => href.includes(p))) return;

            // Check if it's likely a game article (has a slug-like path)
            const hasGameSlug = href.match(/\/[a-z0-9-]+\/[a-z0-9-]+$/); // e.g., /games/final-fantasy-review
            const linkText = a.textContent.toLowerCase().trim();
            
            // Look for review/game indicators in the text
            const isGameArticle = 
                linkText.includes('review') ||
                linkText.includes('game') ||
                linkText.includes('rpg') ||
                linkText.includes('fps') ||
                linkText.includes('action') ||
                hasGameSlug;

            // Filter out hardware/movies
            const badTerms = ['keyboard', 'mouse', 'monitor', 'headset', 'movie', 'tv show'];
            if (badTerms.some(t => linkText.includes(t))) return;

            if (isGameArticle && href !== baseUrl) {
                links.add(href);
            }
        });

        const result = Array.from(links).slice(0, 15); // Get up to 15, we'll limit later
        console.log(`🔗 Found ${result.length} potential game links`);
        return result;
    }
    // ================== END OF LINK EXTRACTION ==================

    // ================== IMPROVED GAME PAGE SCRAPING ==================
    async scrapeGamePage(url) {
        try {
            console.log(`📄 Scraping: ${url}`);
            const html = await this.fetchWithProxy(url);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // ----- Title (usually in h1) -----
            let title = "Not Available";
            const titleElem = doc.querySelector('h1');
            if (titleElem) title = this.cleanText(titleElem.textContent);
            
            // Fallback to meta title
            if (title === "Not Available") {
                const metaTitle = doc.querySelector('meta[property="og:title"]');
                if (metaTitle) title = metaTitle.getAttribute('content') || "Not Available";
            }

            // ----- Release Date -----
            let releaseDate = "Not Available";
            // Try meta tags first
            const metaDate = doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
                             doc.querySelector('meta[name="publication_date"]')?.getAttribute('content');
            if (metaDate) {
                const d = new Date(metaDate);
                if (!isNaN(d)) releaseDate = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            } else {
                // Look for date patterns in text
                const bodyText = doc.body.textContent;
                const dateMatch = bodyText.match(/(?:released?|release date):?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i) ||
                                 bodyText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i);
                if (dateMatch) releaseDate = dateMatch[0];
            }

            // ----- Platforms -----
            let platforms = "Not Available";
            const platformKeywords = ['PS5', 'PS4', 'PlayStation', 'Xbox Series X', 'Xbox Series S', 'Xbox One', 'Switch', 'Nintendo', 'PC', 'iOS', 'Android', 'Steam'];
            const foundPlatforms = [];
            const bodyText = doc.body.textContent;
            platformKeywords.forEach(platform => {
                if (bodyText.includes(platform)) {
                    foundPlatforms.push(platform);
                }
            });
            if (foundPlatforms.length > 0) {
                platforms = [...new Set(foundPlatforms)].join(', ');
            }

            // ----- Developer (look for common patterns) -----
            let developer = "Not Available";
            const devPatterns = [
                /Developer:?\s*([^.<>]+)/i,
                /Developed by ([^.<>]+)/i,
                /开发:?\s*([^。<>\n]+)/i
            ];
            for (const pattern of devPatterns) {
                const match = bodyText.match(pattern);
                if (match && match[1]) {
                    developer = this.cleanText(match[1]);
                    break;
                }
            }

            // ----- Publisher -----
            let publisher = "Not Available";
            const pubPatterns = [
                /Publisher:?\s*([^.<>]+)/i,
                /Published by ([^.<>]+)/i,
                /发行商:?\s*([^。<>\n]+)/i
            ];
            for (const pattern of pubPatterns) {
                const match = bodyText.match(pattern);
                if (match && match[1]) {
                    publisher = this.cleanText(match[1]);
                    break;
                }
            }

            // ----- Key Features -----
            let keyFeatures = "Not Available";
            // Look for a section with features
            const featureHeadings = Array.from(doc.querySelectorAll('h2, h3, h4, strong')).filter(
                h => h.textContent.toLowerCase().includes('key features') || 
                     h.textContent.toLowerCase().includes('features')
            );
            
            if (featureHeadings.length > 0) {
                const list = featureHeadings[0].nextElementSibling;
                if (list && list.tagName === 'UL') {
                    const items = Array.from(list.querySelectorAll('li')).map(li => this.cleanText(li.textContent));
                    if (items.length) keyFeatures = items.join('; ');
                }
            }
            
            if (keyFeatures === "Not Available") {
                // Fallback: use meta description
                const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content');
                if (metaDesc) keyFeatures = metaDesc.substring(0, 200) + '...';
            }

            return {
                title,
                releaseDate,
                platforms,
                developer,
                publisher,
                keyFeatures,
                url
            };
        } catch (error) {
            console.error(`❌ Failed to scrape ${url}:`, error.message);
            return null;
        }
    }
    // ================== END OF GAME PAGE SCRAPING ==================

    // Main scraping method
    async scrapeWebsite(url) {
        try {
            this.updateLoadingMessage('Accessing GamesRadar...');
            
            // Fetch the listing page
            const listingHtml = await this.fetchWithProxy(url);
            this.updateLoadingMessage('Finding game links...');
            
            // Extract game article links
            let gameLinks = this.extractGameLinks(listingHtml, url);
            
            // Filter out the original URL and any category pages
            gameLinks = gameLinks.filter(link => 
                link !== url && 
                !link.includes('/games/') && 
                link.includes('/')
            );

            if (gameLinks.length === 0) {
                throw new Error('No game article links found on this page. Try a different URL like /reviews/ or /games/reviews/');
            }

            // Limit to 10
            gameLinks = gameLinks.slice(0, 10);
            this.gamesData = [];

            this.updateLoadingMessage(`Scraping ${gameLinks.length} game articles...`);

            for (let i = 0; i < gameLinks.length; i++) {
                this.updateLoadingMessage(`Scraping article ${i+1} of ${gameLinks.length}...`);
                const game = await this.scrapeGamePage(gameLinks[i]);
                if (game && game.title !== "Not Available") {
                    this.gamesData.push(game);
                }
                await this.delay(1500); // Be polite
            }

            if (this.gamesData.length === 0) {
                return {
                    success: false,
                    message: 'No game data could be extracted from the articles found.',
                    games: []
                };
            }

            return {
                success: true,
                message: `Successfully extracted ${this.gamesData.length} game(s) from ${url}`,
                games: this.gamesData,
                url: url
            };

        } catch (error) {
            console.error('Scraping error:', error);
            return {
                success: false,
                message: `Error: ${error.message}`,
                games: []
            };
        } finally {
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    }

    updateLoadingMessage(message) {
        const loadingMsg = document.getElementById('loadingMessage');
        if (loadingMsg) loadingMsg.textContent = message;
    }

    displayGames(games, scrapedUrl) {
        const gamesGrid = document.getElementById('gamesGrid');
        const resultsSection = document.getElementById('resultsSection');
        const noResultsSection = document.getElementById('noResultsSection');
        const scrapedUrlSpan = document.getElementById('scrapedUrl');
        const gameCountSpan = document.getElementById('gameCount');
        
        if (games.length === 0) {
            resultsSection.style.display = 'none';
            noResultsSection.style.display = 'block';
            return;
        }

        noResultsSection.style.display = 'none';
        resultsSection.style.display = 'block';
        
        gamesGrid.innerHTML = '';
        scrapedUrlSpan.textContent = scrapedUrl;
        gameCountSpan.textContent = games.length;
        
        games.forEach(game => {
            const card = document.createElement('div');
            card.className = 'game-card';
            card.dataset.title = game.title.toLowerCase();
            
            const features = game.keyFeatures && game.keyFeatures !== "Not Available"
                ? `<li>${game.keyFeatures}</li>`
                : '<li>Not Available</li>';
            
            card.innerHTML = `
                <div class="card-header">
                    <h2>${game.title}</h2>
                </div>
                <div class="card-body">
                    <div class="info-row">
                        <span class="label">Release Date:</span>
                        <span class="value">${game.releaseDate || 'Not Available'}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Platforms:</span>
                        <span class="value">${game.platforms || 'Not Available'}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Developer:</span>
                        <span class="value">${game.developer || 'Not Available'}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Publisher:</span>
                        <span class="value">${game.publisher || 'Not Available'}</span>
                    </div>
                    <div class="features">
                        <span class="label">Key Features:</span>
                        <ul>${features}</ul>
                    </div>
                </div>
            `;
            
            gamesGrid.appendChild(card);
        });
    }

    exportToJSON() {
        if (!this.gamesData || this.gamesData.length === 0) {
            alert('No data to export. Please scrape a website first.');
            return;
        }

        const dataStr = JSON.stringify({
            scraped_url: document.getElementById('scrapedUrl').textContent,
            scrape_date: new Date().toISOString(),
            total_games: this.gamesData.length,
            games: this.gamesData
        }, null, 2);
        
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `gamesradar-games-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    exportToCSV() {
        if (!this.gamesData || this.gamesData.length === 0) {
            alert('No data to export. Please scrape a website first.');
            return;
        }

        const headers = ['Title', 'Release Date', 'Platforms', 'Developer', 'Publisher', 'Key Features'];
        const rows = this.gamesData.map(game => [
            game.title || 'Not Available',
            game.releaseDate || 'Not Available',
            game.platforms || 'Not Available',
            game.developer || 'Not Available',
            game.publisher || 'Not Available',
            game.keyFeatures || 'Not Available'
        ]);
        
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        ].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `gamesradar-games-${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Initialize event listeners
document.addEventListener('DOMContentLoaded', () => {
    const scraper = new WebScraper();
    const scrapeBtn = document.getElementById('scrapeBtn');
    const urlInput = document.getElementById('urlInput');
    const errorMessage = document.getElementById('errorMessage');
    const successMessage = document.getElementById('successMessage');
    const searchInput = document.getElementById('searchInput');
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const tryAgainBtn = document.getElementById('tryAgainBtn');

    scrapeBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        
        if (!url) {
            showError('Please enter a URL to scrape');
            return;
        }

        let finalUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            finalUrl = 'https://' + url;
        }

        errorMessage.style.display = 'none';
        successMessage.style.display = 'none';
        
        loadingOverlay.style.display = 'flex';
        
        const result = await scraper.scrapeWebsite(finalUrl);
        
        loadingOverlay.style.display = 'none';
        
        if (result.success) {
            scraper.displayGames(result.games, finalUrl);
            showSuccess(result.message);
        } else {
            showError(result.message);
            document.getElementById('resultsSection').style.display = 'none';
            document.getElementById('noResultsSection').style.display = 'block';
        }
    });

    tryAgainBtn.addEventListener('click', () => {
        document.getElementById('noResultsSection').style.display = 'none';
        urlInput.focus();
    });

    document.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            urlInput.value = btn.dataset.url;
            scrapeBtn.click();
        });
    });

    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.game-card');
        
        cards.forEach(card => {
            const title = card.dataset.title;
            if (title.includes(searchTerm)) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
        
        const visibleCount = document.querySelectorAll('.game-card[style="display: block;"], .game-card:not([style])').length;
        document.getElementById('gameCount').textContent = visibleCount;
    });

    exportJsonBtn.addEventListener('click', () => scraper.exportToJSON());
    exportCsvBtn.addEventListener('click', () => scraper.exportToCSV());

    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            scrapeBtn.click();
        }
    });

    function showError(message) {
        errorMessage.textContent = '❌ ' + message;
        errorMessage.style.display = 'block';
        setTimeout(() => {
            errorMessage.style.display = 'none';
        }, 5000);
    }

    function showSuccess(message) {
        successMessage.textContent = '✅ ' + message;
        successMessage.style.display = 'block';
        setTimeout(() => {
            successMessage.style.display = 'none';
        }, 5000);
    }
});