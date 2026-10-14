const STORAGE_KEY = 'control_gastos_monthly_v2';
const LEGACY_KEY = 'control_gastos_clean_state';
let selectedMonth = localDate().slice(0, 7);
let ledger = { version: 2, months: {}, loanCategories: [] };
let dataReady = false;
let idSequence = 0;

function localDate() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 1900; }
function cents(value) { return Math.round(Number(value) * 100); }
function sumAmounts(items) { return items.reduce((sum, item) => sum + cents(item.amount), 0); }
function money(value) { return `$${(value / 100).toFixed(2)}`; }
function incomeFrequency(record) { return record.incomeFrequency || 'monthly'; }
function recordedIncome(record) { return cents(record.income); }
function newId() { return Date.now() * 1000 + (idSequence++ % 1000); }
function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function monthLabel(month) {
    return new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(new Date(`${month}-02T12:00:00`));
}
function previousMonth(month) {
    const date = new Date(`${month}-02T12:00:00`);
    date.setMonth(date.getMonth() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function notify(message) {
    const notice = document.getElementById('appNotice');
    notice.textContent = message;
    notice.classList.remove('hidden');
}

function exampleMonth() {
    return {
        income: 600, recorded: true, example: true,
        categories: [
            { id: 1, name: 'Gastos Fijos', type: 'expense', items: [
                { id: 101, name: 'Arriendo', amount: 150 }, { id: 102, name: 'Agua', amount: 20 },
                { id: 103, name: 'Luz', amount: 25 }, { id: 104, name: 'Internet', amount: 25 },
                { id: 105, name: 'Plan celular', amount: 15 }
            ] },
            { id: 2, name: 'Gastos Principales', type: 'expense', items: [
                { id: 201, name: 'Alimentación', amount: 180 }, { id: 202, name: 'Transporte', amount: 70 },
                { id: 203, name: 'Salud', amount: 20 }
            ] },
            { id: 3, name: 'Otros Gastos', type: 'expense', items: [{ id: 301, name: 'Diversión y salidas', amount: 30 }] },
            { id: 4, name: 'Ahorro', type: 'savings', items: [{ id: 401, name: 'Fondo de emergencia', amount: 65 }] }
        ]
    };
}

function validateLedger(value) {
    const validAmount = amount => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(cents(amount));
    const validItem = item => item && Number.isSafeInteger(item.id) && typeof item.name === 'string' && validAmount(item.amount);
    const validCategory = cat => cat && Number.isSafeInteger(cat.id) && typeof cat.name === 'string' && Array.isArray(cat.items);
    if (!value || value.version !== 2 || !value.months || typeof value.months !== 'object' || Array.isArray(value.months) || !Array.isArray(value.loanCategories)) {
        throw new Error('Formato de datos no válido.');
    }
    Object.entries(value.months).forEach(([month, record]) => {
        if (!validMonth(month) || !record || !validAmount(record.income) ||
            (record.incomeFrequency !== undefined && !['monthly', 'fortnightly'].includes(record.incomeFrequency)) ||
            !Number.isSafeInteger(recordedIncome(record)) || !Array.isArray(record.categories) ||
            !record.categories.every(cat => validCategory(cat) && ['expense', 'savings'].includes(cat.type) && cat.items.every(validItem))) {
            throw new Error('Hay un registro mensual no válido.');
        }
    });
    value.loanCategories.forEach(cat => {
        if (!validCategory(cat) || cat.type !== 'loan' || !validMonth(cat.createdMonth) ||
            !cat.items.every(item => validItem(item) && item.amount > 0 && validMonth(item.createdMonth) &&
                item.createdMonth >= cat.createdMonth && Array.isArray(item.payments) &&
                item.payments.every(payment => payment && Number.isSafeInteger(payment.id) &&
                    validAmount(payment.amount) && payment.amount > 0 && validPaymentDate(payment.date) &&
                    payment.date.slice(0, 7) >= item.createdMonth) &&
                sumAmounts(item.payments) <= cents(item.amount))) {
            throw new Error('Hay un préstamo o abono no válido.');
        }
    });
}

function loadData() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            ledger = JSON.parse(saved);
            validateLedger(ledger);
        } else {
            const old = localStorage.getItem(LEGACY_KEY);
            if (old) {
                const record = JSON.parse(old);
                if (!Array.isArray(record.categories)) throw new Error('El presupuesto anterior no es válido.');
                record.categories.forEach(cat => {
                    cat.type = /^ahorro/i.test(cat.name) ? 'savings' : 'expense';
                });
                record.recorded = true;
                ledger.months[selectedMonth] = record;
                validateLedger(ledger);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
                notify('Presupuesto anterior conservado en el mes actual.');
            } else {
                ledger.months[selectedMonth] = exampleMonth();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
            }
        }
        dataReady = true;
        return true;
    } catch (error) {
        console.error('No se pudieron cargar los datos financieros:', error);
        notify('No se pudieron cargar o guardar tus datos. No se sobrescribió el presupuesto anterior. Revisa el almacenamiento del navegador antes de continuar.');
        return false;
    }
}

function monthRecord(month = selectedMonth, source = ledger) {
    return source.months[month] || { income: 0, categories: [], recorded: false };
}
function ensureMonth(source, month = selectedMonth) {
    if (!source.months[month]) source.months[month] = { income: 0, categories: [], recorded: true };
    source.months[month].recorded = true;
    source.months[month].example = false;
    return source.months[month];
}
function commit(change) {
    if (!dataReady) { notify('Los datos no están disponibles. Recarga la página después de revisar el almacenamiento.'); return false; }
    try {
        const next = JSON.parse(JSON.stringify(ledger));
        change(next);
        validateLedger(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        ledger = next;
        renderApp();
        return true;
    } catch (error) {
        console.error('No se pudo guardar el cambio financiero:', error);
        notify(`No se guardó el cambio: ${error.message}`);
        const errorField = document.getElementById('formError');
        if (errorField && !document.getElementById('modal').classList.contains('hidden')) {
            errorField.textContent = `No se guardó el cambio: ${error.message}`;
        }
        return false;
    }
}

function selectMonth(value) {
    if (!validMonth(value)) { notify('Selecciona un mes válido, desde el año 1900.'); document.getElementById('selectedMonth').value = selectedMonth; return; }
    selectedMonth = value;
    closeModal();
    renderApp();
}
function updateIncome(value) {
    const amount = parseAmount(value);
    if (amount === null) { notify('El sueldo debe ser un monto no negativo con un máximo de dos decimales.'); renderApp(); return; }
    if (!commit(next => { ensureMonth(next).income = amount; })) renderApp();
}
function updateIncomeFrequency(value) {
    if (!['monthly', 'fortnightly'].includes(value)) {
        notify('Selecciona ingreso mensual o quincenal.');
        renderApp();
        return;
    }
    if (!commit(next => { ensureMonth(next).incomeFrequency = value; })) renderApp();
}
function resetData() {
    if (!confirm('¿Reemplazar el sueldo y los gastos de este mes por el ejemplo? Los otros meses, préstamos y abonos se conservarán.')) return;
    commit(next => { next.months[selectedMonth] = exampleMonth(); });
}

function visibleCategories(month = selectedMonth, source = ledger) {
    return [...monthRecord(month, source).categories, ...source.loanCategories.filter(cat => cat.createdMonth <= month)];
}
function findCategory(id, source = ledger) {
    const cat = visibleCategories(selectedMonth, source).find(item => item.id === id);
    if (!cat) throw new Error('La categoría ya no está disponible.');
    return cat;
}
function findItem(catId, itemId, source = ledger) {
    const item = findCategory(catId, source).items.find(entry => entry.id === itemId);
    if (!item) throw new Error('El elemento ya no está disponible.');
    return item;
}
function paidThrough(item, month = selectedMonth) {
    return sumAmounts(item.payments.filter(payment => payment.date.slice(0, 7) <= month));
}
function activeLoanSummary(month = selectedMonth) {
    const loans = visibleCategories(month).filter(cat => cat.type === 'loan')
        .flatMap(cat => cat.items.filter(item => item.createdMonth <= month));
    const balances = loans.map(item => cents(item.amount) - paidThrough(item, month)).filter(balance => balance > 0);
    return { count: balances.length, balance: balances.reduce((sum, balance) => sum + balance, 0) };
}
function categoryTotal(cat, month = selectedMonth) {
    return cat.type === 'loan'
        ? cat.items.reduce((sum, item) => sum + sumAmounts(item.payments.filter(payment => payment.date.slice(0, 7) === month)), 0)
        : sumAmounts(cat.items);
}
function totals(month = selectedMonth) {
    const record = monthRecord(month);
    const categories = visibleCategories(month);
    const savings = categories.filter(cat => cat.type === 'savings').reduce((sum, cat) => sum + categoryTotal(cat, month), 0);
    const expenses = categories.filter(cat => cat.type !== 'savings').reduce((sum, cat) => sum + categoryTotal(cat, month), 0);
    const debtPayments = categories.filter(cat => cat.type === 'loan').reduce((sum, cat) => sum + categoryTotal(cat, month), 0);
    const income = recordedIncome(record);
    return { income, expenses, savings, debtPayments, balance: income - expenses - savings,
        recorded: Boolean(record.recorded || debtPayments > 0), example: Boolean(record.example) };
}
function actionButton(label, action, icon, color = 'brand') {
    return `<button onclick="${action}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}" class="text-${color}-500 hover:bg-slate-100 p-2 rounded-lg text-xs"><i class="fa-solid fa-${icon}"></i></button>`;
}
function progressHTML(paid, total, label) {
    const percent = total > 0 ? paid / total * 100 : 0;
    return `<div class="flex items-center gap-2 mt-2"><progress class="w-24 h-1.5 shrink-0" max="100" value="${percent}" aria-label="${escapeHTML(label)}: ${percent.toFixed(1)}% pagado"></progress>
        <span class="text-xs text-slate-500">${percent.toFixed(1)}% pagado</span></div>`;
}

function renderApp() {
    const record = monthRecord();
    const summary = totals();
    document.getElementById('selectedMonth').value = selectedMonth;
    document.getElementById('monthlyIncome').value = record.income;
    document.getElementById('incomeFrequency').value = incomeFrequency(record);
    document.getElementById('incomeLabel').textContent = incomeFrequency(record) === 'fortnightly' ? 'Ingreso por quincena:' : 'Ingreso mensual:';
    document.getElementById('incomeHint').textContent = incomeFrequency(record) === 'fortnightly'
        ? 'Se usa el monto indicado, sin multiplicarlo.' : '';
    document.getElementById('monthStatus').textContent = record.example ? 'Datos de ejemplo' : summary.recorded ? 'Mes con registros' : 'Sin registros';
    const categories = visibleCategories();
    document.getElementById('categoriesContainer').innerHTML = categories.map((cat, index) => {
        const isLoan = cat.type === 'loan';
        const items = cat.items.filter(item => !isLoan || item.createdMonth <= selectedMonth);
        const itemsHTML = items.map(item => {
            const buttons = `${actionButton('Editar', `openEditItemModal(${cat.id},${item.id})`, 'pen')}${actionButton('Eliminar', `deleteItem(${cat.id},${item.id})`, 'trash', 'rose')}`;
            if (!isLoan) return `<div class="flex items-center justify-between gap-2 p-2.5 rounded-xl hover:bg-slate-50">
                <span class="text-sm font-medium break-words">${escapeHTML(item.name)}</span><div class="flex items-center gap-2 shrink-0"><span class="text-sm font-semibold">${money(cents(item.amount))}</span>${buttons}</div></div>`;
            const paid = paidThrough(item);
            const total = cents(item.amount);
            const allPaid = sumAmounts(item.payments);
            const payments = item.payments.filter(payment => payment.date.slice(0, 7) === selectedMonth);
            return `<div class="py-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="min-w-0"><span class="text-sm font-semibold break-words">${escapeHTML(item.name)}</span>
                        <p class="text-xs text-slate-500 mt-1">Saldo al mes: <b class="text-slate-700">${money(total - paid)}</b></p>
                        ${progressHTML(paid, total, 'Avance del préstamo')}
                    </div>
                    <div class="flex items-center gap-1"><button onclick="openPaymentModal(${cat.id},${item.id})" ${allPaid >= total ? 'disabled' : ''} class="rounded-lg bg-brand-50 text-brand-600 px-3 py-2 text-xs font-semibold disabled:opacity-50">${allPaid >= total ? 'Pagado' : '+ Abonar'}</button></div>
                </div>
                <details class="text-xs mt-2"><summary class="cursor-pointer text-slate-400">Detalles y abonos</summary>
                <div class="mt-2 flex flex-wrap items-center justify-between gap-2"><span class="text-slate-500">Deuda: ${money(total)} · Pagado al mes: ${money(paid)}</span><div>${buttons}</div></div>
                ${allPaid > paid ? `<p class="text-slate-500 mt-1">Abonos en meses posteriores: ${money(allPaid - paid)}. Saldo para nuevos abonos: ${money(total - allPaid)}.</p>` : ''}
                <p class="text-slate-500 mt-2">Abonos de este mes: ${money(sumAmounts(payments))}</p>
                ${payments.map(payment => `<div class="flex justify-between items-center py-1"><span>${escapeHTML(payment.date)} · ${money(cents(payment.amount))}</span>${actionButton('Eliminar abono', `deletePayment(${cat.id},${item.id},${payment.id})`, 'trash', 'rose')}</div>`).join('') || '<p class="py-2 text-slate-400">Sin abonos registrados.</p>'}</details>
            </div>`;
        }).join('');
        return `<div class="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm notebook-border-left space-y-3">
            <div class="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3 gap-2">
                <div class="flex items-center gap-2"><span class="text-xs font-bold text-brand-500 bg-brand-50 w-6 h-6 rounded-full flex items-center justify-center">${index + 1}</span><h3 class="font-bold text-base">${escapeHTML(cat.name)}</h3>
                <span class="text-xs text-slate-400">${isLoan ? 'Préstamos' : cat.type === 'savings' ? 'Ahorro' : 'Gastos'}</span></div>
                <div class="flex items-center gap-1"><button onclick="openAddItemModal(${cat.id})" class="text-xs font-medium text-brand-600 bg-brand-50 px-2.5 py-2 rounded-lg">+ ${isLoan ? 'Préstamo' : cat.type === 'savings' ? 'Ahorro' : 'Gasto'}</button>
                ${actionButton('Editar categoría', `openEditCategoryModal(${cat.id})`, 'pen')}${actionButton('Eliminar categoría', `deleteCategory(${cat.id})`, 'trash', 'rose')}</div>
            </div>
            <div class="divide-y divide-slate-100">${itemsHTML || '<p class="text-xs text-slate-400 py-2">Sin elementos en este mes.</p>'}</div>
            <div class="flex justify-between pt-2 border-t border-slate-100 text-sm font-bold"><span>${isLoan ? 'Abonos del mes' : `Total ${escapeHTML(cat.name)}`}</span><span class="text-brand-600">${money(categoryTotal(cat))}</span></div>
        </div>`;
    }).join('') || '<p class="text-sm text-slate-500">Este mes está vacío. Agrega categorías para registrar tus gastos.</p>';
    const row = (label, amount, className = '') => `<tr class="${className}"><td class="py-2.5 px-4">${escapeHTML(label)}</td><td class="py-2.5 px-4 text-right font-semibold">${money(amount)}</td></tr>`;
    document.getElementById('summaryTableBody').innerHTML = row(incomeFrequency(record) === 'fortnightly' ? 'INGRESO QUINCENAL' : 'INGRESO MENSUAL', summary.income, 'bg-blue-50') +
        categories.map(cat => row(`${cat.name}${cat.type === 'loan' ? ' (abonos del mes)' : ''}`, categoryTotal(cat))).join('') +
        row('TOTAL GASTOS (incluye abonos, excluye ahorro)', summary.expenses, 'bg-slate-100') +
        row('AHORRO REGISTRADO', summary.savings) +
        row('DISPONIBLE (después de gastos y ahorro)', summary.balance, summary.balance >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700');
    document.getElementById('cardIncome').textContent = money(summary.income);
    document.getElementById('cardExpenses').textContent = money(summary.expenses);
    const balanceCard = document.getElementById('cardBalance');
    balanceCard.textContent = money(summary.balance);
    balanceCard.classList.toggle('text-emerald-600', summary.balance >= 0);
    balanceCard.classList.toggle('text-rose-600', summary.balance < 0);
    const loans = activeLoanSummary();
    document.getElementById('loanSummaryCard').classList.toggle('hidden', loans.count === 0);
    document.getElementById('cardLoanBalance').textContent = money(loans.balance);
    document.getElementById('cardLoanCount').textContent = `${loans.count} ${loans.count === 1 ? 'préstamo' : 'préstamos'} · saldo al mes`;
    const cards = document.getElementById('dashboardCards');
    cards.classList.toggle('sm:grid-cols-3', loans.count === 0);
    cards.classList.toggle('sm:grid-cols-2', loans.count > 0);
    cards.classList.toggle('lg:grid-cols-4', loans.count > 0);
    if (!document.getElementById('analysisPanel').classList.contains('hidden')) renderAnalysis();
}

const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
function closeModal() { modal.classList.add('hidden'); modal.classList.remove('flex'); }
function showForm(title, fields, action) {
    modalTitle.textContent = title;
    modalBody.innerHTML = `<form onsubmit="event.preventDefault();${action}">
        <div class="space-y-4">${fields}</div><p id="formError" role="alert" class="text-sm text-rose-600 mt-3"></p>
        <div class="flex justify-end gap-2 pt-4"><button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-100 text-slate-600 text-xs font-semibold rounded-xl">Cancelar</button>
        <button type="submit" class="px-4 py-2 bg-brand-500 text-white text-xs font-semibold rounded-xl">Guardar</button></div></form>`;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    const input = modalBody.querySelector('input');
    if (input) input.focus();
}
function field(id, label, type = 'text', value = '', extra = '') {
    return `<div><label for="${id}" class="block text-xs font-semibold text-slate-600 mb-1">${escapeHTML(label)}</label>
        <input id="${id}" type="${type}" value="${escapeHTML(value)}" required ${extra} class="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"></div>`;
}
function formError(message) { document.getElementById('formError').textContent = message; }
function parseAmount(value, positive = false) {
    if (!/^\d+(\.\d{1,2})?$/.test(String(value))) return null;
    const amount = Number(value);
    return Number.isSafeInteger(cents(amount)) && (positive ? amount > 0 : amount >= 0) ? cents(amount) / 100 : null;
}
function categoryTypeField(type, loanLocked = false) {
    return `<div><label for="catType" class="block text-xs font-semibold text-slate-600 mb-1">Tipo de categoría</label>
        <select id="catType" ${loanLocked ? 'disabled' : ''} class="w-full px-3 py-2 border border-slate-300 rounded-xl">
        ${[['expense', 'Gastos'], ['savings', 'Ahorro'], ['loan', 'Préstamos (deuda total y abonos)']].map(([value, label]) => `<option value="${value}" ${value === type ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <p class="text-xs text-slate-500 mt-2">Los préstamos se comparten entre meses. Gastos y ahorro pertenecen solo al mes seleccionado.</p></div>`;
}
function suggestCategoryType() {
    const name = document.getElementById('catName').value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    document.getElementById('catType').value = /prestamo|deuda/.test(name) ? 'loan' : /ahorro/.test(name) ? 'savings' : 'expense';
}
function openAddCategoryModal() {
    showForm('Nueva categoría', field('catName', 'Nombre de la categoría', 'text', '', 'oninput="suggestCategoryType()" maxlength="100"') + categoryTypeField('expense'), 'saveCategory()');
}
function saveCategory() {
    const name = document.getElementById('catName').value.trim();
    const type = document.getElementById('catType').value;
    if (!name) { formError('Escribe un nombre.'); return; }
    if (commit(next => {
        const category = { id: newId(), name, type, items: [] };
        if (type === 'loan') { category.createdMonth = selectedMonth; next.loanCategories.push(category); }
        else ensureMonth(next).categories.push(category);
    })) closeModal();
}
function openEditCategoryModal(catId) {
    const cat = findCategory(catId);
    showForm('Editar categoría', field('catName', 'Nombre', 'text', cat.name, 'maxlength="100"') +
        categoryTypeField(cat.type, cat.type === 'loan'), `updateCategory(${catId})`);
}
function updateCategory(catId) {
    const name = document.getElementById('catName').value.trim();
    const type = document.getElementById('catType').value;
    if (!name) { formError('Escribe un nombre.'); return; }
    const original = findCategory(catId);
    if (type === 'loan' && original.type !== 'loan' && original.items.length) {
        formError('Para conservar los gastos anteriores, crea una nueva categoría de préstamos. Solo una categoría vacía puede cambiar a préstamos.');
        return;
    }
    if (commit(next => {
        const cat = findCategory(catId, next);
        cat.name = name;
        if (cat.type !== 'loan') {
            ensureMonth(next);
            cat.type = type;
            if (type === 'loan') {
                next.months[selectedMonth].categories = next.months[selectedMonth].categories.filter(entry => entry.id !== catId);
                cat.id = newId();
                cat.createdMonth = selectedMonth;
                next.loanCategories.push(cat);
            }
        }
    })) closeModal();
}
function deleteCategory(catId) {
    const cat = findCategory(catId);
    if (!confirm(cat.type === 'loan' ? '¿Eliminar esta categoría, sus préstamos y TODOS sus abonos? Esto modificará los totales de los meses con abonos.' : '¿Eliminar esta categoría y sus registros de este mes?')) return;
    commit(next => {
        if (cat.type === 'loan') next.loanCategories = next.loanCategories.filter(entry => entry.id !== catId);
        else ensureMonth(next).categories = next.months[selectedMonth].categories.filter(entry => entry.id !== catId);
    });
}
function itemFields(cat, item) {
    return field('itemName', 'Concepto', 'text', item ? item.name : '', 'maxlength="100"') +
        field('itemAmount', cat.type === 'loan' ? 'Deuda total a pagar ($), incluidos intereses si corresponde' : 'Monto ($)', 'number',
            item ? item.amount : '', `min="${cat.type === 'loan' ? '0.01' : '0'}" step="0.01"`) +
        (cat.type === 'loan' ? '<p class="text-xs text-slate-500">La deuda total no es un gasto mensual. Registra los pagos con el botón Abonar.</p>' : '');
}
function openAddItemModal(catId) {
    const cat = findCategory(catId);
    showForm(cat.type === 'loan' ? 'Nuevo préstamo' : cat.type === 'savings' ? 'Agregar ahorro' : 'Agregar gasto', itemFields(cat), `saveItem(${catId})`);
}
function openEditItemModal(catId, itemId) {
    showForm('Editar registro', itemFields(findCategory(catId), findItem(catId, itemId)), `saveItem(${catId},${itemId})`);
}
function saveItem(catId, itemId) {
    const cat = findCategory(catId);
    const name = document.getElementById('itemName').value.trim();
    const amount = parseAmount(document.getElementById('itemAmount').value, cat.type === 'loan');
    if (!name || amount === null) { formError('Escribe un nombre y un monto válido con hasta dos decimales. La deuda debe ser mayor que cero.'); return; }
    if (itemId && cat.type === 'loan' && cents(amount) < sumAmounts(findItem(catId, itemId).payments)) {
        formError('La deuda total no puede ser menor que los abonos ya registrados, incluidos meses posteriores.'); return;
    }
    if (commit(next => {
        const target = findCategory(catId, next);
        if (target.type !== 'loan') ensureMonth(next);
        if (itemId) Object.assign(findItem(catId, itemId, next), { name, amount });
        else target.items.push({ id: newId(), name, amount, ...(target.type === 'loan' ? { createdMonth: selectedMonth, payments: [] } : {}) });
    })) closeModal();
}
function deleteItem(catId, itemId) {
    const cat = findCategory(catId);
    if (!confirm(cat.type === 'loan' ? '¿Eliminar el préstamo y todos sus abonos? Se actualizarán los meses afectados.' : '¿Eliminar este registro del mes?')) return;
    commit(next => {
        if (cat.type !== 'loan') ensureMonth(next);
        const target = findCategory(catId, next);
        target.items = target.items.filter(item => item.id !== itemId);
    });
}
function validPaymentDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    return !Number.isNaN(date.getTime()) && date.getFullYear() === Number(value.slice(0, 4)) &&
        date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10));
}
function openPaymentModal(catId, itemId) {
    const item = findItem(catId, itemId);
    const remaining = cents(item.amount) - sumAmounts(item.payments);
    const lastDay = new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0).getDate();
    showForm(`Abonar a ${item.name}`, `<p class="text-sm text-slate-600">Saldo para nuevos abonos: <b>${money(remaining)}</b>. El abono se contará en ${escapeHTML(monthLabel(selectedMonth))}.</p>` +
        field('paymentAmount', 'Abono ($)', 'number', '', `min="0.01" max="${remaining / 100}" step="0.01"`) +
        field('paymentDate', 'Fecha del abono', 'date', selectedMonth === localDate().slice(0, 7) ? localDate() : `${selectedMonth}-01`,
            `min="${selectedMonth}-01" max="${selectedMonth}-${lastDay}"`), `savePayment(${catId},${itemId})`);
}
function savePayment(catId, itemId) {
    const amount = parseAmount(document.getElementById('paymentAmount').value, true);
    const date = document.getElementById('paymentDate').value;
    const item = findItem(catId, itemId);
    if (amount === null || cents(amount) > cents(item.amount) - sumAmounts(item.payments)) {
        formError('El abono debe ser mayor que cero y no superar el saldo pendiente.'); return;
    }
    if (!validPaymentDate(date) || date.slice(0, 7) !== selectedMonth || date.slice(0, 7) < item.createdMonth) {
        formError('La fecha debe corresponder al mes seleccionado y no ser anterior al préstamo.'); return;
    }
    if (commit(next => {
        ensureMonth(next);
        findItem(catId, itemId, next).payments.push({ id: newId(), amount, date });
    })) closeModal();
}
function deletePayment(catId, itemId, paymentId) {
    if (!confirm('¿Eliminar este abono? Se corregirá el gasto de ese mes y el avance del préstamo.')) return;
    commit(next => {
        const item = findItem(catId, itemId, next);
        item.payments = item.payments.filter(payment => payment.id !== paymentId);
    });
}

function toggleAnalysis() {
    const panel = document.getElementById('analysisPanel');
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    document.getElementById('budgetView').classList.toggle('hidden', opening);
    document.getElementById('incomePanel').classList.toggle('hidden', opening);
    document.getElementById('analyzeButton').setAttribute('aria-expanded', String(opening));
    closeModal();
    if (opening) {
        renderAnalysis();
        document.getElementById('analysisTitle').focus();
    } else {
        document.getElementById('analyzeButton').focus();
    }
}
function financialAssessment(summary) {
    if (!summary.recorded) return { tone: 'slate', title: 'Sin datos suficientes', text: 'Registra el sueldo, gastos y ahorro de este mes para poder evaluarlo.' };
    if (summary.income === 0) return { tone: 'amber', title: 'Falta un ingreso para evaluar', text: 'No hay ingreso registrado. No se pueden calcular porcentajes sobre el sueldo.' };
    if (summary.expenses > summary.income) return { tone: 'rose', title: 'Atención: gastas más de lo que ingresas', text: `Tus gastos y abonos exceden tu ingreso en ${money(summary.expenses - summary.income)}. Reduce gastos o revisa tu plan de pagos.` };
    if (summary.balance < 0) return { tone: 'rose', title: 'Tus asignaciones superan el ingreso', text: 'Los gastos, abonos y ahorro registrados suman más que tu sueldo. Ajusta las asignaciones para no quedar en negativo.' };
    const margin = (summary.income - summary.expenses) / summary.income;
    return margin >= 0.2
        ? { tone: 'emerald', title: 'Vas bien según lo registrado', text: `Después de gastos y abonos conservas un ${(margin * 100).toFixed(1)}% del ingreso para ahorro o disponible. Mantén el control y completa los gastos que falten.` }
        : { tone: 'amber', title: 'Vas ajustado: puedes mejorar', text: `El margen después de gastos y abonos es ${(margin * 100).toFixed(1)}%. Intenta acercarlo al 20% para contar con mayor espacio para ahorro e imprevistos.` };
}
function renderAnalysis() {
    const summary = totals();
    const assessment = financialAssessment(summary);
    document.getElementById('analysisMonth').textContent = `· ${monthLabel(selectedMonth)}`;
    const verdict = document.getElementById('analysisVerdict');
    verdict.className = `rounded-xl p-4 text-sm bg-${assessment.tone}-50 text-${assessment.tone}-800`;
    verdict.innerHTML = `<strong>${assessment.title}</strong><p class="mt-1">${assessment.text}</p>
        ${summary.recorded ? `<p class="mt-2">Ingreso: ${money(summary.income)} · Gastos y abonos: ${money(summary.expenses)} · Ahorro: ${money(summary.savings)} · Disponible: ${money(summary.balance)}.</p>` : ''}
        ${summary.income > 0 && summary.debtPayments / summary.income > 0.3 ? '<p class="mt-2 font-semibold">Los abonos superan el 30% del ingreso. Revisa cuánto espacio dejan para tus necesidades.</p>' : ''}
        ${summary.example ? '<p class="mt-2 font-semibold">Este mes contiene datos de ejemplo; reemplázalos por tus registros reales.</p>' : ''}`;
    renderComparison();
    renderMonthChart();
}
function renderComparison() {
    const priorMonth = previousMonth(selectedMonth);
    const prior = totals(priorMonth);
    const current = totals();
    const chart = document.getElementById('comparisonChart');
    const note = document.getElementById('comparisonNote');
    if (!prior.recorded || !current.recorded) {
        chart.innerHTML = '<div class="rounded-lg bg-slate-50 p-6 text-sm text-slate-500">No hay registros suficientes para comparar ambos meses.</div>';
        note.textContent = `Se necesitan registros de ${monthLabel(priorMonth)} y ${monthLabel(selectedMonth)}. No se inventan datos de meses vacíos.`;
        return;
    }
    const labels = ['Ingreso', 'Gastos', 'Abonos', 'Ahorro', 'Disponible'];
    const values = summary => [summary.income, summary.expenses - summary.debtPayments, summary.debtPayments, summary.savings, summary.balance];
    const series = [
        { name: monthLabel(priorMonth), values: values(prior), color: '#06bf98' },
        { name: monthLabel(selectedMonth), values: values(current), color: '#0062a8' }
    ];
    chart.innerHTML = lineChartHTML(labels, series, `Comparación por concepto entre ${monthLabel(priorMonth)} y ${monthLabel(selectedMonth)}`) +
        `<div class="text-xs space-y-1 mt-3">${labels.map((label, index) => `<div>${label}: ${money(series[0].values[index])} → ${money(series[1].values[index])}</div>`).join('')}</div>`;
    const delta = current.expenses - prior.expenses;
    note.textContent = `Los gastos y abonos ${delta > 0 ? 'aumentaron' : delta < 0 ? 'disminuyeron' : 'no cambiaron'}${delta === 0 ? '' : ` en ${money(Math.abs(delta))}`}. Las líneas comparan conceptos, no días del mes.${prior.example || current.example ? ' Incluye datos de ejemplo.' : ''}`;
}
function renderMonthChart() {
    const summary = totals();
    const entries = visibleCategories().map(cat => ({
        name: `${cat.name}${cat.type === 'loan' ? ' (abonos)' : ''}`,
        amount: categoryTotal(cat)
    }));
    entries.push({ name: summary.balance < 0 ? 'Déficit' : 'Disponible', amount: summary.balance });
    if (!summary.recorded) {
        document.getElementById('monthChart').innerHTML = '<p class="text-sm text-slate-500 p-6">Este mes no tiene registros.</p>';
        return;
    }
    document.getElementById('monthChart').innerHTML = lineChartHTML(entries.map(entry => entry.name), [
        { name: monthLabel(selectedMonth), color: '#0062a8', values: entries.map(entry => entry.amount) }
    ], `Distribución por categoría de ${monthLabel(selectedMonth)}`) +
        `<div class="mt-3 text-xs space-y-1">${entries.map((entry, index) => `<div>${index + 1}. ${escapeHTML(entry.name)}: <b>${money(entry.amount)}</b>${summary.income > 0 ? ` (${(entry.amount / summary.income * 100).toFixed(1)}% del ingreso)` : ''}</div>`).join('')}</div>
        <p class="mt-2 text-xs text-slate-400">Cada punto es una categoría o el saldo disponible, no una fecha.</p>`;
}

function smoothPath(points) {
    return points.map((point, index) => {
        if (index === 0) return `M ${point.x} ${point.y}`;
        const prior = points[index - 1];
        const middle = (prior.x + point.x) / 2;
        return `C ${middle} ${prior.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
    }).join(' ');
}

function lineChartHTML(labels, series, title) {
    const amounts = series.flatMap(item => item.values);
    const min = Math.min(0, ...amounts);
    const max = Math.max(100, ...amounts);
    const y = amount => 190 - (amount - min) / (max - min) * 160;
    const x = index => labels.length === 1 ? 300 : 80 + index / (labels.length - 1) * 440;
    const numbered = labels.length > 6 || labels.some(label => label.length > 12);
    return `<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-2">${series.map(item => `<span style="color:${item.color}">● ${escapeHTML(item.name)}</span>`).join('')}</div>
        <svg viewBox="0 0 560 235" class="chart" role="img" aria-label="${escapeHTML(title)}">
        ${[0, 0.25, 0.5, 0.75, 1].map(ratio => {
            const amount = min + (max - min) * ratio;
            return `<line x1="80" y1="${y(amount)}" x2="520" y2="${y(amount)}" stroke="#e2e8f0"/>
                <text x="70" y="${y(amount) + 4}" text-anchor="end" font-size="11" fill="#64748b">${money(Math.round(amount))}</text>`;
        }).join('')}
        ${labels.map((label, index) => `<line x1="${x(index)}" y1="30" x2="${x(index)}" y2="190" stroke="#f1f5f9"/>
            <text x="${x(index)}" y="218" text-anchor="middle" font-size="11" fill="#64748b">${numbered ? index + 1 : escapeHTML(label)}</text>`).join('')}
        ${series.map(item => {
            const points = item.values.map((amount, index) => ({ x: x(index), y: y(amount) }));
            return `<path d="${smoothPath(points)}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                ${points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="${item.color}" tabindex="0"><title>${escapeHTML(item.name)} · ${escapeHTML(labels[index])}: ${money(item.values[index])}</title></circle>`).join('')}`;
        }).join('')}</svg>`;
}
