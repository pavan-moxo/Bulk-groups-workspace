let accessToken = null;
let tokenExpiry = null;
let isRunning = false;

const REQUIRED_COLUMNS = ["workspace_name", "member_email"];

function addLog(message, type = "info") {
    const logContainer = document.getElementById("logContainer");
    if (!logContainer) return;
    const div = document.createElement("div");
    div.className = `log-entry ${type}`;
    const icon = type === "success" ? "fa-check-circle" : type === "error" ? "fa-exclamation-circle" : "fa-info-circle";
    div.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
    logContainer.appendChild(div);
    div.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function getVal(id) {
    return document.getElementById(id)?.value || "";
}

function getChecked(id) {
    return document.getElementById(id)?.checked || false;
}

function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (char === '"' && inQuotes && next === '"') {
            value += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
            row.push(value);
            value = "";
        } else if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && next === "\n") i++;
            row.push(value);
            if (row.some((cell) => String(cell).trim())) rows.push(row);
            row = [];
            value = "";
        } else {
            value += char;
        }
    }

    row.push(value);
    if (row.some((cell) => String(cell).trim())) rows.push(row);
    return rows;
}

function rowsToObjects(csvText) {
    const rows = parseCsv(csvText);
    if (rows.length < 2) return [];

    const headers = rows[0].map(normalizeHeader);
    return rows.slice(1).map((row) => {
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = String(row[index] || "").trim();
        });
        return obj;
    });
}

function getMemberEmail(row) {
    return row.member_email || row.email || row.user_email || "";
}

function getWorkspaceName(row) {
    return row.workspace_name || row.binder_name || row.group_name || "";
}

function isIncluded(row) {
    const include = String(row.include || "yes").trim().toLowerCase();
    return !["no", "false", "0", "skip"].includes(include);
}

function parseLaunchRows() {
    const text = getVal("launchRowsList");
    const rows = rowsToObjects(text)
        .filter(isIncluded)
        .map((row, index) => ({
            ...row,
            rowNumber: index + 2,
            workspace_name: getWorkspaceName(row),
            member_email: getMemberEmail(row),
            member_type: String(row.member_type || "").trim().toUpperCase(),
            member_name: row.member_name || row.name || "",
            member_source: row.member_source || "",
        }))
        .filter((row) => row.workspace_name || row.member_email);

    return rows;
}

function groupRowsByWorkspace(rows) {
    const grouped = new Map();

    for (const row of rows) {
        if (!row.workspace_name || !row.member_email) continue;
        if (!grouped.has(row.workspace_name)) {
            grouped.set(row.workspace_name, {
                name: row.workspace_name,
                building: row.building || "",
                batch: row.batch || "",
                rows: [],
            });
        }
        grouped.get(row.workspace_name).rows.push(row);
    }

    return Array.from(grouped.values());
}

function validateLaunchRows(rows) {
    const errors = [];
    const rawHeaders = parseCsv(getVal("launchRowsList"))[0] || [];
    const headers = rawHeaders.map(normalizeHeader);

    for (const required of REQUIRED_COLUMNS) {
        if (!headers.includes(required) && !(required === "member_email" && headers.includes("email"))) {
            errors.push(`Missing required column: ${required}`);
        }
    }

    rows.forEach((row) => {
        if (!row.workspace_name) errors.push(`Row ${row.rowNumber}: missing workspace_name`);
        if (!row.member_email) errors.push(`Row ${row.rowNumber}: missing member_email`);
        if (row.member_email && !row.member_email.includes("@")) errors.push(`Row ${row.rowNumber}: invalid email ${row.member_email}`);
    });

    const groups = groupRowsByWorkspace(rows);
    groups.forEach((group) => {
        const uniqueEmails = new Set();
        let ownerCount = 0;
        group.rows.forEach((row) => {
            const email = row.member_email.toLowerCase();
            if (uniqueEmails.has(email)) {
                errors.push(`${group.name}: duplicate member ${row.member_email}`);
            }
            uniqueEmails.add(email);
            if (row.member_type === "BOARD_OWNER") ownerCount++;
        });
        if (ownerCount === 0) errors.push(`${group.name}: missing BOARD_OWNER row`);
        if (ownerCount > 1) errors.push(`${group.name}: has ${ownerCount} BOARD_OWNER rows; use one`);
    });

    return errors;
}

function updateCounts() {
    const rows = parseLaunchRows();
    const groups = groupRowsByWorkspace(rows);
    const memberCount = rows.filter((row) => row.workspace_name && row.member_email).length;
    const workspaceCount = document.getElementById("workspaceCount");
    const memberCountEl = document.getElementById("memberCount");
    const validationStatus = document.getElementById("validationStatus");

    if (workspaceCount) workspaceCount.innerText = `${groups.length} workspaces`;
    if (memberCountEl) memberCountEl.innerText = `${memberCount} members`;

    if (validationStatus) {
        const errors = validateLaunchRows(rows);
        validationStatus.innerText = errors.length ? `${errors.length} issue(s)` : "Ready";
        validationStatus.className = errors.length ? "count-badge danger" : "count-badge success";
    }
}

function saveConfig() {
    const config = {
        domain: getVal("domain"),
        orgId: getVal("orgId"),
        clientId: getVal("clientId"),
        clientSecret: getVal("clientSecret"),
        identityType: getVal("identityType"),
        identityValue: getVal("identityValue"),
        binderDescription: getVal("binderDescription"),
        referenceIdTemplate: getVal("referenceIdTemplate"),
        restricted: getChecked("restricted"),
        suppressFeed: getChecked("suppressFeed"),
    };
    localStorage.setItem("moxo_group_launch_config", JSON.stringify(config));
}

function loadSavedData() {
    const saved = localStorage.getItem("moxo_group_launch_config");
    if (saved) {
        try {
            const config = JSON.parse(saved);
            Object.entries(config).forEach(([key, value]) => {
                const id = key === "orgId" ? "orgId" : key;
                const el = document.getElementById(id);
                if (!el) return;
                if (el.type === "checkbox") el.checked = Boolean(value);
                else el.value = value || "";
            });
        } catch (e) {}
    }

    const savedToken = localStorage.getItem("moxo_group_launch_token");
    if (savedToken) {
        try {
            const tokenData = JSON.parse(savedToken);
            if (new Date(tokenData.expiry) > new Date()) {
                accessToken = tokenData.access_token;
                tokenExpiry = tokenData.expiry;
                document.getElementById("tokenDot")?.classList.add("valid");
                const tokenStatus = document.getElementById("tokenStatus");
                if (tokenStatus) tokenStatus.innerText = "Token Ready";
            }
        } catch (e) {}
    }

    attachListeners();
    updateCounts();
}

function attachListeners() {
    const launchRowsList = document.getElementById("launchRowsList");
    if (launchRowsList) launchRowsList.addEventListener("input", updateCounts);

    ["domain", "orgId", "clientId", "clientSecret", "identityType", "identityValue", "binderDescription", "referenceIdTemplate"].forEach((id) => {
        document.getElementById(id)?.addEventListener("input", saveConfig);
    });
    document.getElementById("restricted")?.addEventListener("change", saveConfig);
    document.getElementById("suppressFeed")?.addEventListener("change", saveConfig);

    document.getElementById("identityType")?.addEventListener("change", function() {
        const type = this.value;
        const label = document.getElementById("identityLabel");
        const input = document.getElementById("identityValue");
        if (type === "email") {
            if (label) label.innerText = "Identity Value (Email)";
            if (input) input.placeholder = "admin@example.com";
        } else if (type === "unique_id") {
            if (label) label.innerText = "Identity Value (Unique ID)";
            if (input) input.placeholder = "user_123";
        } else {
            if (label) label.innerText = "Identity Value (Phone)";
            if (input) input.placeholder = "+1234567890";
        }
        saveConfig();
    });
}

async function generateToken() {
    let domain = getVal("domain").replace(/^https?:\/\//, "");
    const orgId = getVal("orgId");
    const clientId = getVal("clientId");
    const clientSecret = getVal("clientSecret");
    const identityType = getVal("identityType") || "email";
    const identityValue = getVal("identityValue");

    if (!domain || !orgId || !clientId || !clientSecret || !identityValue) {
        addLog("Please fill all credential fields", "error");
        return;
    }

    addLog("Requesting token...", "info");

    const payload = {
        client_id: clientId,
        client_secret: clientSecret,
        org_id: orgId,
        [identityType]: identityValue,
    };

    try {
        const response = await fetch(`https://${domain}/v1/core/oauth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await response.json();

        if (data.access_token) {
            accessToken = data.access_token;
            tokenExpiry = new Date(Date.now() + (data.expires_in || 43200) * 1000);
            localStorage.setItem("moxo_group_launch_token", JSON.stringify({
                access_token: accessToken,
                expiry: tokenExpiry.toISOString(),
            }));
            document.getElementById("tokenDot")?.classList.add("valid");
            const tokenStatus = document.getElementById("tokenStatus");
            if (tokenStatus) tokenStatus.innerText = "Token Ready";
            addLog("Token generated successfully", "success");
            saveConfig();
        } else {
            addLog(`Token failed: ${data.message || data.error || "Unknown error"}`, "error");
        }
    } catch (error) {
        addLog(`Token error: ${error.message}`, "error");
    }
}

function buildReferenceId(group, settings) {
    if (!settings.referenceIdTemplate) return null;
    return settings.referenceIdTemplate
        .replace(/{{workspace_name}}/g, group.name)
        .replace(/{{building}}/g, group.building || "")
        .replace(/{{batch}}/g, group.batch || "");
}

function buildUsers(group) {
    const seen = new Set();
    return group.rows.map((row) => {
        const email = row.member_email.trim();
        const lowerEmail = email.toLowerCase();
        if (seen.has(lowerEmail)) return null;
        seen.add(lowerEmail);

        const user = { email };
        if (row.member_type === "BOARD_OWNER") user.member_type = "BOARD_OWNER";
        return { user };
    }).filter(Boolean);
}

async function createGroupedBinder(group, settings) {
    if (!accessToken) return { success: false, error: "No token" };

    const payload = {
        name: group.name,
        users: buildUsers(group),
    };

    if (settings.description) payload.description = settings.description;
    const referenceId = buildReferenceId(group, settings);
    if (referenceId) payload.reference_id = referenceId;
    if (settings.restricted) payload.restricted = true;
    if (settings.suppressFeed) payload.suppress_feed = true;

    try {
        const response = await fetch(`https://${settings.domain}/v1/${settings.orgId}/binders`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify(payload),
        });
        const data = await response.json();

        if (data.code === "RESPONSE_SUCCESS") {
            return { success: true, binderId: data.data?.id, name: group.name };
        }
        return { success: false, error: data.message || data.code || "API error" };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function createGroupBinders() {
    if (!accessToken) {
        addLog("Generate token first", "error");
        return;
    }

    const rows = parseLaunchRows();
    const errors = validateLaunchRows(rows);
    if (errors.length) {
        errors.slice(0, 20).forEach((error) => addLog(error, "error"));
        if (errors.length > 20) addLog(`${errors.length - 20} more validation issue(s) not shown`, "error");
        return;
    }

    const groups = groupRowsByWorkspace(rows);
    let domain = getVal("domain").replace(/^https?:\/\//, "");
    const orgId = getVal("orgId");
    if (!domain || !orgId) {
        addLog("Please configure domain and organization ID", "error");
        return;
    }

    const settings = {
        domain,
        orgId,
        description: getVal("binderDescription"),
        referenceIdTemplate: getVal("referenceIdTemplate"),
        restricted: getChecked("restricted"),
        suppressFeed: getChecked("suppressFeed"),
    };

    addLog("All member emails must already exist in your Moxo organization.", "info");
    addLog(`Creating ${groups.length} grouped workspace(s) from ${rows.length} member row(s).`, "info");

    isRunning = true;
    let successCount = 0;
    let errorCount = 0;

    const createBtn = document.getElementById("createBtn");
    const statusBadge = document.getElementById("statusBadge");
    const progressSection = document.getElementById("progressSection");
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Creating...';
    }
    if (statusBadge) {
        statusBadge.classList.add("running");
        statusBadge.innerText = "Creating...";
    }
    if (progressSection) progressSection.style.display = "block";

    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        addLog(`[${i + 1}/${groups.length}] Creating ${group.name} with ${group.rows.length} member(s)...`, "info");
        const result = await createGroupedBinder(group, settings);

        if (result.success) {
            successCount++;
            addLog(`Created ${group.name} (ID: ${result.binderId || "created"})`, "success");
        } else {
            errorCount++;
            addLog(`Failed ${group.name}: ${result.error}`, "error");
        }

        const percent = ((i + 1) / groups.length) * 100;
        const progressFill = document.getElementById("progressFill");
        const progressText = document.getElementById("progressText");
        const successCountSpan = document.getElementById("successCount");
        const errorCountSpan = document.getElementById("errorCount");
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressText) progressText.innerText = `${i + 1}/${groups.length} processed`;
        if (successCountSpan) successCountSpan.innerText = successCount;
        if (errorCountSpan) errorCountSpan.innerText = errorCount;
    }

    isRunning = false;
    if (createBtn) {
        createBtn.disabled = false;
        createBtn.innerHTML = '<i class="fas fa-play"></i> Create Group Workspaces';
    }
    if (statusBadge) {
        statusBadge.classList.remove("running");
        statusBadge.innerText = "Ready";
    }

    addLog(`Complete. Success: ${successCount}, Failed: ${errorCount}`, errorCount ? "info" : "success");
}

function clearLogs() {
    const logContainer = document.getElementById("logContainer");
    if (logContainer) {
        logContainer.innerHTML = '<div class="log-entry info"><i class="fas fa-check-circle"></i> Logs cleared</div>';
    }
}

function toggleConfig() {
    document.getElementById("configPanel")?.classList.toggle("show");
}

function uploadCSV() {
    document.getElementById("launchCsv")?.click();
}

function handleCSVUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const textarea = document.getElementById("launchRowsList");
        if (textarea) textarea.value = e.target.result;
        updateCounts();
        addLog(`Loaded ${file.name}`, "success");
    };
    reader.readAsText(file);
    input.value = "";
}

function downloadSampleCSV() {
    const content = [
        "workspace_name,building,batch,member_email,member_name,member_type,member_source,unit_keys,include,notes",
        "Sample Tower A,Sample Tower,A,client001@example.com,Sample Client 001,MEMBER,owner,ST101,yes,",
        "Sample Tower A,Sample Tower,A,client002@example.com,Sample Client 002,MEMBER,owner,ST102,yes,",
        "Sample Tower A,Sample Tower,A,pavan.prasad@moxo.com,Internal Owner 1,BOARD_OWNER,internal,,yes,",
        "Sample Tower A,Sample Tower,A,raman.singh@moxo.com,Internal Owner 2,MEMBER,internal,,yes,",
        "Sample Tower A,Sample Tower,A,service.team@example.com,Service Team,MEMBER,internal,,yes,",
        "Partner Lofts,Partner Lofts,A,client026@example.com,Sample Client 026,MEMBER,owner,PL101,yes,",
        "Partner Lofts,Partner Lofts,A,pavan.prasad@moxo.com,Internal Owner 1,BOARD_OWNER,internal,,yes,",
        "Partner Lofts,Partner Lofts,A,raman.singh@moxo.com,Internal Owner 2,MEMBER,internal,,yes,",
        "Service Court,Service Court,A,client030@example.com,Sample Client 030,MEMBER,owner,SC101,yes,",
        "Service Court,Service Court,A,pavan.prasad@moxo.com,Internal Owner 1,BOARD_OWNER,internal,,yes,",
        "Service Court,Service Court,A,service.team@example.com,Service Team,MEMBER,internal,,yes,",
        "Owner Only,Owner Only,A,client033@example.com,Sample Client 033,MEMBER,owner,OO101,yes,",
        "Owner Only,Owner Only,A,pavan.prasad@moxo.com,Internal Owner 1,BOARD_OWNER,internal,,yes,",
    ].join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "group_members_launch_sample.csv";
    a.click();
    URL.revokeObjectURL(url);
}

function clearLaunchRows() {
    const launchRowsList = document.getElementById("launchRowsList");
    if (launchRowsList) launchRowsList.value = "";
    updateCounts();
}

document.addEventListener("DOMContentLoaded", () => {
    loadSavedData();
    addLog("Ready. Upload one grouped member CSV, then generate a token.", "success");
});

window.generateToken = generateToken;
window.createGroupBinders = createGroupBinders;
window.clearLogs = clearLogs;
window.toggleConfig = toggleConfig;
window.uploadCSV = uploadCSV;
window.handleCSVUpload = handleCSVUpload;
window.downloadSampleCSV = downloadSampleCSV;
window.clearLaunchRows = clearLaunchRows;
