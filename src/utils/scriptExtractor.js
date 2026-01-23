export const extractScriptFromHTML = (htmlContent) => {
    if (!htmlContent) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Strategy 1: Look for the specific table structure
    const tables = doc.querySelectorAll('table');

    for (const table of tables) {
        const rows = table.querySelectorAll('tr');

        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length === 0) continue;

            // Get first column content
            const firstCell = cells[0];
            const text = firstCell.innerText.trim();

            // validation: Check if it looks like the script
            // - Longer than 50 chars (avoids Audio row)
            // - Contains key markers
            if (text.length > 50 &&
                (text.includes('Video Title') ||
                    text.includes('ANCHOR VOICE') ||
                    text.includes('Got it') ||
                    text.includes('SEGMENT 1'))) {

                return cleanScriptText(text);
            }
        }
    }

    // Strategy 2: If no table match, search for the largest text block containing keywords
    // (Fallback for non-table pages)
    const allText = doc.body.innerText;
    if (allText.includes('ANCHOR VOICE')) {
        return cleanScriptText(allText);
    }

    return 'No script found. Please ensure the page follows the standard format.';
};

const cleanScriptText = (text) => {
    // Remove "Got it..." prefix if present, but user might want it?
    // User said "we want that info only from first colom... this will be the script"
    // So we keep it mostly as is, just basic cleanup.

    return text
        .replace(/\u00A0/g, ' ') // Replace non-breaking spaces
        .trim();
};

// Helper to identify segments for automation later
export const parseSegments = (scriptText) => {
    const segments = [];
    const lines = scriptText.split('\n');
    let currentSegment = null;

    lines.forEach(line => {
        const trimmed = line.trim();
        // Regex for "SEGMENT 1", "SEGMENT 2", etc.
        if (/✅? ?SEGMENT \d+/.test(trimmed)) {
            if (currentSegment) segments.push(currentSegment);
            currentSegment = { title: trimmed, content: '' };
        } else if (currentSegment) {
            currentSegment.content += trimmed + '\n';
        }
    });

    if (currentSegment) segments.push(currentSegment);
    return segments;
};
