const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

test('income controls and analysis share the top header', () => {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/);
    assert.ok(header);
    for (const id of ['incomePanel', 'monthlyIncome', 'incomeFrequency', 'incomeHint', 'analyzeButton']) {
        assert.ok(header[1].includes(`id="${id}"`), `${id} must be in the header`);
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} must remain unique`);
    }
    assert.match(header[1], /openAddCategoryModal\(\)/);
    assert.doesNotMatch(html, /<section id="incomePanel"/);
});

function harness(initial = {}) {
    const storage = new Map(Object.entries(initial));
    const elements = new Map();
    const errors = [];
    const context = vm.createContext({
        console: { error: (...args) => errors.push(args) },
        Date, Intl, confirm: () => true,
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value)
        },
        document: {
            getElementById: id => {
                if (!elements.has(id)) {
                    const classes = new Set(['hidden']);
                    elements.set(id, {
                        value: '', textContent: '', innerHTML: '',
                        classList: {
                            add: name => classes.add(name), remove: name => classes.delete(name),
                            contains: name => classes.has(name),
                            toggle: (name, force) => force ? classes.add(name) : classes.delete(name)
                        },
                        setAttribute() {}, focus() {}, querySelector: () => null
                    });
                }
                return elements.get(id);
            }
        }
    });
    vm.runInContext(source, context);
    const run = code => vm.runInContext(code, context);
    const value = code => JSON.parse(JSON.stringify(run(code)));
    const input = (id, val) => { context.document.getElementById(id).value = val; };
    return { run, value, input, storage, elements, context, errors };
}

test('first use preserves example; unvisited months are not fabricated', () => {
    const app = harness();
    assert.equal(app.run('loadData()'), true);
    assert.deepEqual(app.value('totals()'), {
        income: 60000, expenses: 53500, savings: 6500, debtPayments: 0, balance: 0, recorded: true, example: true
    });
    app.run("selectMonth('2026-08')");
    assert.equal(app.run('totals().recorded'), false);
    app.run('renderComparison()');
    assert.match(app.elements.get('comparisonChart').innerHTML, /No hay registros suficientes/);
    assert.equal(app.run("Object.hasOwn(ledger.months, '2026-08')"), false);
});

test('legacy migration keeps income, categories and original storage', () => {
    const legacy = { income: 1200, categories: [
        { id: 1, name: 'Comida', items: [{ id: 2, name: 'Mercado', amount: 50.25 }] },
        { id: 3, name: 'Ahorro', items: [{ id: 4, name: 'Reserva', amount: 100 }] }
    ] };
    const raw = JSON.stringify(legacy);
    const app = harness({ control_gastos_clean_state: raw });
    assert.equal(app.run('loadData()'), true);
    assert.equal(app.run('totals().income'), 120000);
    assert.equal(app.run('totals().expenses'), 5025);
    assert.equal(app.run('totals().savings'), 10000);
    assert.equal(app.storage.get('control_gastos_clean_state'), raw);
    assert.equal(app.run('monthRecord().categories[0].name'), 'Comida');
    assert.ok(app.storage.has('control_gastos_monthly_v2'));
});

test('monthly income and ordinary CRUD remain isolated and reload correctly', () => {
    const app = harness();
    app.run("loadData(); selectMonth('2026-08'); updateIncome('1000')");
    app.input('catName', 'Gastos');
    app.input('catType', 'expense');
    app.run('saveCategory(); globalThis.catId = monthRecord().categories[0].id');
    app.input('itemName', 'Comida');
    app.input('itemAmount', '250.10');
    app.run('saveItem(catId); globalThis.itemId = monthRecord().categories[0].items[0].id');
    assert.equal(app.run('totals().expenses'), 25010);
    app.input('itemAmount', '260.20');
    app.run('saveItem(catId, itemId)');
    assert.equal(app.run('totals().expenses'), 26020);
    app.run("selectMonth('2026-09'); updateIncome('900')");
    assert.equal(app.run('totals().expenses'), 0);
    assert.equal(app.run('totals().income'), 90000);
    const reloaded = harness(Object.fromEntries(app.storage));
    reloaded.run("loadData(); selectMonth('2026-08')");
    assert.equal(reloaded.run('totals().expenses'), 26020);
    assert.equal(reloaded.run('totals().income'), 100000);
    app.run("selectMonth('2026-08'); deleteItem(catId, itemId)");
    assert.equal(app.run('totals().expenses'), 0);
    app.run('deleteCategory(catId)');
    assert.equal(app.run('monthRecord().categories.length'), 0);
});

function loanHarness() {
    const app = harness();
    app.run("loadData(); selectMonth('2026-08'); updateIncome('1000')");
    app.input('catName', 'Préstamos');
    app.run('suggestCategoryType()');
    assert.equal(app.elements.get('catType').value, 'loan');
    app.run('saveCategory(); globalThis.catId = ledger.loanCategories[0].id');
    app.input('itemName', 'Préstamo personal');
    app.input('itemAmount', '1000');
    app.run('saveItem(catId); globalThis.itemId = ledger.loanCategories[0].items[0].id');
    return app;
}
function payment(app, amount, date) {
    app.input('paymentAmount', amount);
    app.input('paymentDate', date);
    app.run('savePayment(catId, itemId)');
}

test('loan payments count only in their month; historical progress excludes future payments', () => {
    const app = loanHarness();
    assert.equal(app.run('totals().expenses'), 0);
    payment(app, '200', '2026-08-15');
    assert.equal(app.run('totals().expenses'), 20000);
    assert.equal(app.run('paidThrough(findItem(catId, itemId))'), 20000);
    app.run("selectMonth('2026-09'); updateIncome('1100')");
    payment(app, '300', '2026-09-15');
    assert.equal(app.run('totals().expenses'), 30000);
    assert.equal(app.run('paidThrough(findItem(catId, itemId))'), 50000);
    app.run('renderComparison()');
    assert.match(app.elements.get('comparisonChart').innerHTML, /<path d="M [^"]*C /);
    assert.match(app.elements.get('comparisonChart').innerHTML, /\$200\.00 → \$300\.00/);
    app.run("selectMonth('2026-08')");
    assert.equal(app.run('totals().expenses'), 20000);
    assert.equal(app.run('paidThrough(findItem(catId, itemId))'), 20000);
    assert.match(app.elements.get('categoriesContainer').innerHTML, /20.0% pagado/);
    assert.match(app.elements.get('categoriesContainer').innerHTML, /Abonos en meses posteriores/);
    const reload = harness(Object.fromEntries(app.storage));
    reload.run("loadData(); selectMonth('2026-09')");
    assert.equal(reload.run('totals().expenses'), 30000);
    app.run("selectMonth('2026-07')");
    assert.equal(app.run('visibleCategories().length'), 0);
});

test('loan overpayments, invalid dates, and reducing total below paid are rejected', () => {
    const app = loanHarness();
    payment(app, '200', '2026-08-15');
    for (const [amount, date] of [['801', '2026-08-16'], ['0', '2026-08-16'], ['-1', '2026-08-16'], ['100', '2026-09-01'], ['100', '2026-08-32'], ['0.001', '2026-08-16']]) {
        payment(app, amount, date);
        assert.ok(app.elements.get('formError').textContent);
        assert.equal(app.run('findItem(catId, itemId).payments.length'), 1);
    }
    app.input('itemAmount', '199.99');
    app.run('saveItem(catId, itemId)');
    assert.equal(app.run('findItem(catId, itemId).amount'), 1000);
    payment(app, '800', '2026-08-20');
    assert.equal(app.run('paidThrough(findItem(catId, itemId))'), 100000);
    assert.match(app.elements.get('categoriesContainer').innerHTML, /100.0% pagado/);
});

test('cent precision, payment deletion and reset preserve other months and debts', () => {
    const app = loanHarness();
    payment(app, '0.10', '2026-08-15');
    payment(app, '0.20', '2026-08-16');
    assert.equal(app.run('totals().expenses'), 30);
    app.run('deletePayment(catId, itemId, findItem(catId, itemId).payments[0].id)');
    assert.equal(app.run('totals().expenses'), 20);
    app.run("selectMonth('2026-09'); updateIncome('1500'); resetData()");
    assert.equal(app.run('ledger.loanCategories.length'), 1);
    assert.equal(app.run("totals('2026-08').expenses"), 20);
    app.run('deleteItem(catId, itemId)');
    assert.equal(app.run("totals('2026-08').expenses"), 0);
});

test('assessment thresholds, zero income, overspending, and saving over-allocation', () => {
    const app = harness();
    const base = { income: 100000, expenses: 80000, savings: 10000, balance: 10000, recorded: true };
    app.context.summary = base;
    assert.equal(app.run('financialAssessment(summary).tone'), 'emerald');
    app.context.summary = { ...base, expenses: 80001 };
    assert.equal(app.run('financialAssessment(summary).tone'), 'amber');
    app.context.summary = { ...base, expenses: 100001, balance: -1 };
    assert.equal(app.run('financialAssessment(summary).tone'), 'rose');
    app.context.summary = { ...base, savings: 30000, balance: -10000 };
    assert.equal(app.run('financialAssessment(summary).tone'), 'rose');
    app.context.summary = { ...base, income: 0 };
    assert.match(app.run('financialAssessment(summary).title'), /Falta un ingreso/);
    app.context.summary = { ...base, recorded: false };
    assert.equal(app.run('financialAssessment(summary).tone'), 'slate');
    assert.equal(app.run("previousMonth('2026-01')"), '2025-12');
});

test('invalid or inaccessible storage is explicit and never overwrites existing data', () => {
    const app = harness({ control_gastos_monthly_v2: '{invalid', control_gastos_clean_state: '{"income":500}' });
    assert.equal(app.run('loadData()'), false);
    assert.equal(app.storage.get('control_gastos_monthly_v2'), '{invalid');
    assert.match(app.elements.get('appNotice').textContent, /No se pudieron cargar/);
    assert.equal(app.run('commit(next => { next.months = {}; })'), false);
    const failing = harness();
    failing.run('loadData()');
    const before = failing.storage.get('control_gastos_monthly_v2');
    failing.context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    failing.run("updateIncome('1234')");
    assert.equal(failing.run('totals().income'), 60000);
    assert.equal(failing.storage.get('control_gastos_monthly_v2'), before);
    assert.match(failing.elements.get('appNotice').textContent, /No se guardó el cambio/);
});

test('user text is escaped in categories, inputs, loan titles and charts', () => {
    const app = loanHarness();
    app.input('itemName', '<img src=x onerror=alert(1)>');
    app.input('itemAmount', '1000');
    app.run('saveItem(catId, itemId)');
    assert.doesNotMatch(app.elements.get('categoriesContainer').innerHTML, /<img src=x/);
    assert.match(app.elements.get('categoriesContainer').innerHTML, /&lt;img/);
    assert.equal(app.run("validPaymentDate('2026-02-29')"), false);
    assert.equal(app.run("validPaymentDate('2028-02-29')"), true);
});

test('category type changes preserve expenses and avoid ID conflicts with reset examples', () => {
    const app = harness();
    app.run('loadData()');
    app.input('catName', 'Préstamos');
    app.input('catType', 'loan');
    app.run('updateCategory(1)');
    assert.match(app.elements.get('formError').textContent, /crea una nueva categoría/);
    assert.equal(app.run('monthRecord().categories[0].type'), 'expense');
    app.run('commit(next => { next.months[selectedMonth].categories[0].items = []; }); updateCategory(1)');
    assert.equal(app.run('ledger.loanCategories.length'), 1);
    assert.notEqual(app.run('ledger.loanCategories[0].id'), 1);
    app.run('globalThis.convertedId = ledger.loanCategories[0].id; resetData()');
    assert.equal(app.run("findCategory(1).type"), 'expense');
    assert.equal(app.run("findCategory(convertedId).type"), 'loan');
    app.input('catName', 'Ahorro extra');
    app.input('catType', 'savings');
    app.run('updateCategory(3)');
    assert.equal(app.run('totals().savings'), 9500);
});

test('invalid income and month changes never alter saved records', () => {
    const app = harness();
    app.run('loadData()');
    const before = app.storage.get('control_gastos_monthly_v2');
    for (const amount of ['-10', '', 'Infinity', '0.001']) app.run(`updateIncome(${JSON.stringify(amount)})`);
    assert.equal(app.storage.get('control_gastos_monthly_v2'), before);
    app.run("selectMonth('2026-13')");
    assert.equal(app.storage.get('control_gastos_monthly_v2'), before);
    assert.match(app.elements.get('appNotice').textContent, /mes válido/);
});

test('fortnightly amount doubles monthly income across dashboard, analysis and persistence', () => {
    const app = harness();
    app.run("loadData(); selectMonth('2026-08'); updateIncome('500.25'); updateIncomeFrequency('fortnightly')");
    assert.equal(app.run('monthRecord().income'), 500.25);
    assert.equal(app.run('totals().income'), 100050);
    assert.equal(app.elements.get('cardIncome').textContent, '$1000.50');
    assert.equal(app.elements.get('incomeLabel').textContent, 'Ingreso por quincena:');
    assert.match(app.elements.get('incomeHint').textContent, /\$500.25 × 2 = \$1000.50/);
    app.run('renderAnalysis()');
    assert.match(app.elements.get('analysisVerdict').innerHTML, /Ingreso: \$1000.50/);
    const reload = harness(Object.fromEntries(app.storage));
    reload.run("loadData(); selectMonth('2026-08')");
    assert.equal(reload.elements.get('incomeFrequency').value, 'fortnightly');
    assert.equal(reload.run('totals().income'), 100050);
    app.run("selectMonth('2026-09'); updateIncome('800')");
    assert.equal(app.run('totals().income'), 80000);
    assert.equal(app.elements.get('incomeFrequency').value, 'monthly');
    app.run("selectMonth('2026-08'); updateIncomeFrequency('monthly')");
    assert.equal(app.run('totals().income'), 50025);
    app.run("updateIncomeFrequency('invalid')");
    assert.equal(app.run('totals().income'), 50025);
    assert.match(app.elements.get('appNotice').textContent, /mensual o quincenal/);
});

test('existing monthly records without frequency retain their original income', () => {
    const app = harness();
    app.run('loadData()');
    assert.equal(app.run('monthRecord().incomeFrequency'), undefined);
    assert.equal(app.run('totals().income'), 60000);
    app.run('renderApp()');
    assert.equal(app.elements.get('incomeFrequency').value, 'monthly');
});

test('analysis is a separate view and returning restores budget controls', () => {
    const app = harness();
    app.run('loadData(); renderApp(); toggleAnalysis()');
    assert.equal(app.elements.get('analysisPanel').classList.contains('hidden'), false);
    assert.equal(app.elements.get('budgetView').classList.contains('hidden'), true);
    assert.equal(app.elements.get('incomePanel').classList.contains('hidden'), true);
    app.run("selectMonth('2026-08')");
    assert.match(app.elements.get('analysisMonth').textContent, /agosto/);
    assert.equal(app.elements.get('budgetView').classList.contains('hidden'), true);
    app.run('toggleAnalysis()');
    assert.equal(app.elements.get('analysisPanel').classList.contains('hidden'), true);
    assert.equal(app.elements.get('budgetView').classList.contains('hidden'), false);
    assert.equal(app.elements.get('incomePanel').classList.contains('hidden'), false);
});

test('loan UI uses one small bar and hides detail and edit actions in disclosures', () => {
    const app = loanHarness();
    payment(app, '250', '2026-08-15');
    const html = app.elements.get('categoriesContainer').innerHTML;
    assert.equal((html.match(/<progress/g) || []).length, 1);
    assert.match(html, /w-24 h-1.5/);
    assert.match(html, /25.0% pagado/);
    assert.match(html, /Saldo al mes:.*\$750.00/);
    assert.doesNotMatch(html, /Avance de la categoría/);
    const detail = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
    assert.match(detail, /Detalles y abonos/);
    assert.match(detail, /openEditItemModal/);
    assert.match(detail, /Eliminar abono/);
});

test('curved charts contain real points, handle negatives and do not overshoot segments', () => {
    const app = harness();
    app.run("loadData(); selectMonth('2026-08'); updateIncome('1000'); selectMonth('2026-09'); updateIncome('500'); renderAnalysis()");
    const comparison = app.elements.get('comparisonChart').innerHTML;
    assert.equal((comparison.match(/<circle/g) || []).length, 10);
    assert.equal((comparison.match(/<path/g) || []).length, 2);
    assert.match(comparison, /#06bf98/);
    assert.match(comparison, /#0062a8/);
    assert.match(comparison, /Ingreso: \$1000.00 → \$500.00/);
    assert.doesNotMatch(comparison, /polyline|NaN|Infinity/);
    app.run('commit(next => { ensureMonth(next).categories.push({id:123,name:"Necesidades",type:"expense",items:[{id:124,name:"Casa",amount:600}]}); }); renderMonthChart()');
    assert.match(app.elements.get('monthChart').innerHTML, /Déficit: <b>\$-100.00/);
    assert.doesNotMatch(app.elements.get('monthChart').innerHTML, /<rect|NaN|Infinity/);
    assert.equal(app.run('smoothPath([{x:0,y:0},{x:10,y:100},{x:20,y:50}])'), 'M 0 0 C 5 0, 5 100, 10 100 C 15 100, 15 50, 20 50');
    assert.match(app.run('lineChartHTML(["Solo"], [{name:"Mes",color:"#0062a8",values:[0]}], "Sin monto")'), /cx="300"/);
});

test('active loan card shows remaining principal without adding it to monthly expenses', () => {
    const app = loanHarness();
    assert.deepEqual(app.value('activeLoanSummary()'), { count: 1, balance: 100000 });
    assert.equal(app.elements.get('loanSummaryCard').classList.contains('hidden'), false);
    assert.equal(app.elements.get('cardLoanBalance').textContent, '$1000.00');
    assert.equal(app.run('totals().expenses'), 0);
    payment(app, '250', '2026-08-15');
    assert.equal(app.elements.get('cardLoanBalance').textContent, '$750.00');
    assert.equal(app.run('totals().expenses'), 25000);
    assert.equal(app.run('totals().balance'), 75000);
    assert.equal(app.elements.get('dashboardCards').classList.contains('lg:grid-cols-4'), true);
    payment(app, '750', '2026-08-20');
    assert.equal(app.elements.get('loanSummaryCard').classList.contains('hidden'), true);
    assert.equal(app.elements.get('dashboardCards').classList.contains('sm:grid-cols-3'), true);
    app.run('deletePayment(catId, itemId, findItem(catId, itemId).payments[1].id)');
    assert.equal(app.elements.get('cardLoanBalance').textContent, '$750.00');
    app.run('deleteItem(catId, itemId)');
    assert.equal(app.elements.get('loanSummaryCard').classList.contains('hidden'), true);
});

test('loan summary aggregates categories and follows historical month balances', () => {
    const app = loanHarness();
    payment(app, '200', '2026-08-15');
    app.run("selectMonth('2026-09')");
    payment(app, '800', '2026-09-15');
    app.run("commit(next => { next.loanCategories.push({id:700,name:'Otros préstamos',type:'loan',createdMonth:'2026-09',items:[{id:701,name:'Deuda A',amount:50.10,createdMonth:'2026-09',payments:[]},{id:702,name:'Deuda B',amount:20.20,createdMonth:'2026-09',payments:[]}]}); })");
    assert.deepEqual(app.value('activeLoanSummary()'), { count: 2, balance: 7030 });
    assert.equal(app.elements.get('cardLoanCount').textContent, '2 préstamos · saldo al mes');
    app.run("selectMonth('2026-08')");
    assert.deepEqual(app.value('activeLoanSummary()'), { count: 1, balance: 80000 });
    app.run("selectMonth('2026-07')");
    assert.deepEqual(app.value('activeLoanSummary()'), { count: 0, balance: 0 });
    assert.equal(app.elements.get('loanSummaryCard').classList.contains('hidden'), true);
    const reload = harness(Object.fromEntries(app.storage));
    reload.run("loadData(); selectMonth('2026-09')");
    assert.equal(reload.elements.get('cardLoanBalance').textContent, '$70.30');
});
