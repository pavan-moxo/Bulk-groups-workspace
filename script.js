let accessToken = null;
let tokenExpiry = null;
let isRunning = false;
const advisorTokenCache = new Map();

const REQUIRED_COLUMNS = ["workspace_name", "member_email"];
const INVITE_REQUIRED_COLUMNS = ["advisor_email", "first_name"];

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

function getClientEmail(row) {
    return row.client_email || row.email || row.member_email || "";
}

function isIncluded(row) {
    const include = String(row.include || "yes").trim().toLowerCase();
    return !["no", "false", "0", "skip"].includes(include);
}

function parseInviteRows() {
    const text = getVal("inviteRowsList");
    return rowsToObjects(text)
        .filter(isIncluded)
        .map((row, index) => ({
            ...row,
            rowNumber: index + 2,
            advisor_email: row.advisor_email || row.rm_email || row.relationship_manager_email || "",
            client_email: getClientEmail(row),
            first_name: row.first_name || "",
            last_name: row.last_name || "",
            unique_id: row.unique_id || "",
            phone_number: row.phone_number || "",
            greet_message: row.greet_message || "",
        }))
        .filter((row) => row.advisor_email || row.client_email || row.unique_id || row.phone_number);
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

function validateInviteRows(rows) {
    const errors = [];
    const rawHeaders = parseCsv(getVal("inviteRowsList"))[0] || [];
    const headers = rawHeaders.map(normalizeHeader);

    for (const required of INVITE_REQUIRED_COLUMNS) {
        if (!headers.includes(required)) errors.push(`Invite CSV missing required column: ${required}`);
    }

    rows.forEach((row) => {
        if (!row.advisor_email) errors.push(`Invite row ${row.rowNumber}: missing advisor_email`);
        if (row.advisor_email && !row.advisor_email.includes("@")) errors.push(`Invite row ${row.rowNumber}: invalid advisor_email ${row.advisor_email}`);
        if (!row.client_email && !row.unique_id && !row.phone_number) {
            errors.push(`Invite row ${row.rowNumber}: provide client_email, unique_id, or phone_number`);
        }
        if (row.client_email && !row.client_email.includes("@")) errors.push(`Invite row ${row.rowNumber}: invalid client_email ${row.client_email}`);
        if (!row.first_name) errors.push(`Invite row ${row.rowNumber}: missing first_name`);
    });

    return errors;
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
    updateInviteCounts();
    updateGroupCounts();
}

function updateInviteCounts() {
    const rows = parseInviteRows();
    const advisors = new Set(rows.map((row) => row.advisor_email).filter(Boolean));
    const inviteCount = document.getElementById("inviteCount");
    const advisorCount = document.getElementById("advisorCount");
    const validationStatus = document.getElementById("inviteValidationStatus");

    if (inviteCount) inviteCount.innerText = `${rows.length} invite row${rows.length === 1 ? "" : "s"}`;
    if (advisorCount) advisorCount.innerText = `${advisors.size} advisor${advisors.size === 1 ? "" : "s"}`;

    if (validationStatus) {
        const errors = validateInviteRows(rows);
        validationStatus.innerText = errors.length ? `${errors.length} issue(s)` : rows.length ? "Ready" : "No data";
        validationStatus.className = errors.length ? "count-badge danger" : rows.length ? "count-badge success" : "count-badge";
    }
}

function updateGroupCounts() {
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
    const inviteRowsList = document.getElementById("inviteRowsList");
    if (inviteRowsList) inviteRowsList.addEventListener("input", updateCounts);

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

async function requestTokenForIdentity(identityType, identityValue) {
    let domain = getVal("domain").replace(/^https?:\/\//, "");
    const orgId = getVal("orgId");
    const clientId = getVal("clientId");
    const clientSecret = getVal("clientSecret");

    if (!domain || !orgId || !clientId || !clientSecret || !identityValue) {
        throw new Error("Missing token configuration");
    }

    const cacheKey = `${identityType}:${identityValue.toLowerCase()}`;
    const cached = advisorTokenCache.get(cacheKey);
    if (cached && cached.expiry > Date.now() + 60000) return cached.accessToken;

    const payload = {
        client_id: clientId,
        client_secret: clientSecret,
        org_id: orgId,
        [identityType]: identityValue,
    };

    const response = await fetch(`https://${domain}/v1/core/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = await parseApiResponse(response);

    if (!response.ok || !data.access_token) {
        throw new Error(`Token failed for ${identityValue}: ${data.message || data.error || data.code || response.status}`);
    }

    advisorTokenCache.set(cacheKey, {
        accessToken: data.access_token,
        expiry: Date.now() + (data.expires_in || 43200) * 1000,
    });
    return data.access_token;
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

function summarizePayload(payload) {
    return JSON.stringify({
        name: payload.name,
        users: payload.users?.map((entry) => ({
            email: entry.user?.email,
            member_type: entry.user?.member_type || "MEMBER",
        })),
        reference_id: payload.reference_id,
        restricted: payload.restricted,
        suppress_feed: payload.suppress_feed,
    });
}

async function parseApiResponse(response) {
    const text = await response.text();
    if (!text) return {};

    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function formatApiError(response, data, payload) {
    const detail = data?.message || data?.error || data?.code || data?.raw || "API error";
    const extra = data?.data ? ` | data: ${JSON.stringify(data.data)}` : "";
    return `HTTP ${response.status}: ${detail}${extra} | payload: ${summarizePayload(payload)}`;
}

function buildInvitePayload(row) {
    const payload = {};
    if (row.unique_id) payload.unique_id = row.unique_id;
    if (row.client_email) payload.email = row.client_email;
    if (row.phone_number) payload.phone_number = row.phone_number;
    if (row.first_name) payload.first_name = row.first_name;
    if (row.last_name) payload.last_name = row.last_name;
    if (row.greet_message) payload.greet_message = row.greet_message;
    return payload;
}

async function inviteRelationshipClient(row, settings) {
    const token = await requestTokenForIdentity("email", row.advisor_email);
    const payload = buildInvitePayload(row);

    const response = await fetch(`https://${settings.domain}/v1/me/relationship/invite`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });
    const data = await parseApiResponse(response);

    if (response.ok && data.code === "RESPONSE_SUCCESS") {
        return {
            success: true,
            relationId: data.data?.relation_id,
            binderId: data.data?.binder_id,
            status: data.data?.status,
        };
    }

    return { success: false, error: formatApiError(response, data, payload) };
}

function setRunningState(running, buttonId, runningLabel, readyLabel) {
    const button = document.getElementById(buttonId);
    const statusBadge = document.getElementById("statusBadge");
    const progressSection = document.getElementById("progressSection");

    isRunning = running;
    if (button) {
        button.disabled = running;
        button.innerHTML = running ? `<i class="fas fa-spinner fa-pulse"></i> ${runningLabel}` : readyLabel;
    }
    if (statusBadge) {
        statusBadge.classList.toggle("running", running);
        statusBadge.innerText = running ? "Running..." : "Ready";
    }
    if (progressSection && running) progressSection.style.display = "block";
}

function updateProgress(current, total, successCount, errorCount) {
    const percent = total ? (current / total) * 100 : 0;
    const progressFill = document.getElementById("progressFill");
    const progressText = document.getElementById("progressText");
    const successCountSpan = document.getElementById("successCount");
    const errorCountSpan = document.getElementById("errorCount");
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressText) progressText.innerText = `${current}/${total} processed`;
    if (successCountSpan) successCountSpan.innerText = successCount;
    if (errorCountSpan) errorCountSpan.innerText = errorCount;
}

async function inviteRelationshipClients() {
    const rows = parseInviteRows();
    const errors = validateInviteRows(rows);
    if (errors.length) {
        errors.slice(0, 20).forEach((error) => addLog(error, "error"));
        if (errors.length > 20) addLog(`${errors.length - 20} more invite validation issue(s) not shown`, "error");
        return;
    }

    let domain = getVal("domain").replace(/^https?:\/\//, "");
    const orgId = getVal("orgId");
    const clientId = getVal("clientId");
    const clientSecret = getVal("clientSecret");
    if (!domain || !orgId || !clientId || !clientSecret) {
        addLog("Please configure domain, organization ID, client ID, and client secret", "error");
        return;
    }

    const settings = { domain };
    addLog(`Inviting ${rows.length} client relationship(s). The advisor_email token is used for each row.`, "info");

    let successCount = 0;
    let errorCount = 0;
    setRunningState(true, "inviteBtn", "Inviting...", '<i class="fas fa-user-plus"></i> Invite RM Clients');

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        addLog(`[${i + 1}/${rows.length}] Inviting ${row.client_email || row.unique_id || row.phone_number} under ${row.advisor_email}...`, "info");

        try {
            const result = await inviteRelationshipClient(row, settings);
            if (result.success) {
                successCount++;
                addLog(`Invited ${row.client_email || row.unique_id || row.phone_number} (relation: ${result.relationId || "created"}, status: ${result.status || "unknown"}, binder: ${result.binderId || "pending"})`, "success");
            } else {
                errorCount++;
                addLog(`Failed invite for ${row.client_email || row.unique_id || row.phone_number}: ${result.error}`, "error");
            }
        } catch (error) {
            errorCount++;
            addLog(`Failed invite for ${row.client_email || row.unique_id || row.phone_number}: ${error.message}`, "error");
        }

        updateProgress(i + 1, rows.length, successCount, errorCount);
    }

    setRunningState(false, "inviteBtn", "Inviting...", '<i class="fas fa-user-plus"></i> Invite RM Clients');
    addLog(`Client invite complete. Success: ${successCount}, Failed: ${errorCount}`, errorCount ? "info" : "success");
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
        const data = await parseApiResponse(response);

        if (response.ok && data.code === "RESPONSE_SUCCESS") {
            return { success: true, binderId: data.data?.id, name: group.name };
        }
        return { success: false, error: formatApiError(response, data, payload) };
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

    let successCount = 0;
    let errorCount = 0;

    setRunningState(true, "createBtn", "Creating...", '<i class="fas fa-play"></i> Create Group Workspaces');

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

        updateProgress(i + 1, groups.length, successCount, errorCount);
    }

    setRunningState(false, "createBtn", "Creating...", '<i class="fas fa-play"></i> Create Group Workspaces');

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

function uploadInviteCSV() {
    document.getElementById("inviteCsv")?.click();
}

function handleInviteCSVUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const textarea = document.getElementById("inviteRowsList");
        if (textarea) textarea.value = e.target.result;
        updateCounts();
        addLog(`Loaded ${file.name}`, "success");
    };
    reader.readAsText(file);
    input.value = "";
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

function downloadInviteSampleCSV() {
    const content = [
        "advisor_email,client_email,first_name,last_name,unique_id,phone_number,greet_message,include",
        "pavan.prasad@moxo.com,sample.client001@yopmail.com,Sample,Client 001,,,Welcome to join,yes",
        "pavan.prasad@moxo.com,sample.client002@yopmail.com,Sample,Client 002,,,Welcome to join,yes",
        "raman.singh@moxo.com,sample.client003@yopmail.com,Sample,Client 003,,,Welcome to join,yes",
        "raman.singh@moxo.com,sample.client004@yopmail.com,Sample,Client 004,,,Welcome to join,yes",
    ].join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rm_client_invites_sample.csv";
    a.click();
    URL.revokeObjectURL(url);
}

function downloadSampleCSV() {
    const content = [
        "workspace_name,member_email,member_name,member_type,include",
        "Sample Group 01,sample.client001@yopmail.com,Sample Client 001,MEMBER,yes",
        "Sample Group 01,sample.client002@yopmail.com,Sample Client 002,MEMBER,yes",
        "Sample Group 01,pavan.prasad@moxo.com,Internal Owner 1,BOARD_OWNER,yes",
        "Sample Group 01,raman.singh@moxo.com,Internal Owner 2,MEMBER,yes",
        "Sample Group 02,sample.client003@yopmail.com,Sample Client 003,MEMBER,yes",
        "Sample Group 02,sample.client004@yopmail.com,Sample Client 004,MEMBER,yes",
        "Sample Group 02,pavan.prasad@moxo.com,Internal Owner 1,BOARD_OWNER,yes",
        "Sample Group 02,raman.singh@moxo.com,Internal Owner 2,MEMBER,yes",
    ].join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "group_workspaces_sample.csv";
    a.click();
    URL.revokeObjectURL(url);
}

function clearLaunchRows() {
    const launchRowsList = document.getElementById("launchRowsList");
    if (launchRowsList) launchRowsList.value = "";
    updateCounts();
}

function clearInviteRows() {
    const inviteRowsList = document.getElementById("inviteRowsList");
    if (inviteRowsList) inviteRowsList.value = "";
    updateCounts();
}

document.addEventListener("DOMContentLoaded", () => {
    loadSavedData();
    addLog("Ready. Upload invite CSV and group CSV, then generate a token.", "success");
});

window.generateToken = generateToken;
window.inviteRelationshipClients = inviteRelationshipClients;
window.createGroupBinders = createGroupBinders;
window.clearLogs = clearLogs;
window.toggleConfig = toggleConfig;
window.uploadInviteCSV = uploadInviteCSV;
window.uploadCSV = uploadCSV;
window.handleInviteCSVUpload = handleInviteCSVUpload;
window.handleCSVUpload = handleCSVUpload;
window.downloadInviteSampleCSV = downloadInviteSampleCSV;
window.downloadSampleCSV = downloadSampleCSV;
window.clearInviteRows = clearInviteRows;
window.clearLaunchRows = clearLaunchRows;
