const billingService = require('../services/billingService');

async function generateMonthlyBills(req, res, next) {
    try {
        const { householdId } = req.user;
        const { billingMonth } = req.body;

        if (!billingMonth) {
            return res.status(400).json({ error: { message: 'billingMonth (YYYY-MM) is required', status: 400 } });
        }

        const bills = await billingService.generateMonthlyBills(householdId, billingMonth, req.user);
        res.status(200).json({ bills });
    } catch (err) {
        next(err);
    }
}

async function getBills(req, res, next) {
    try {
        const { householdId } = req.user;
        const { month, userId } = req.query;

        const bills = await billingService.getBills(householdId, {
            billingMonth: month,
            userId,
            actingUser: req.user
        });

        res.status(200).json({ bills });
    } catch (err) {
        next(err);
    }
}

async function getBillById(req, res, next) {
    try {
        const { householdId } = req.user;
        const billId = parseInt(req.params.id, 10);

        if (isNaN(billId)) {
            return res.status(400).json({ error: { message: 'Invalid bill ID', status: 400 } });
        }

        const bill = await billingService.getBillById(householdId, billId, req.user);
        res.status(200).json({ bill });
    } catch (err) {
        next(err);
    }
}

async function recordPayment(req, res, next) {
    try {
        const { householdId } = req.user;
        const billId = parseInt(req.params.id, 10);
        const { amountPaise, idempotencyKey } = req.body;

        if (isNaN(billId)) {
            return res.status(400).json({ error: { message: 'Invalid bill ID', status: 400 } });
        }

        const payment = await billingService.recordPayment(householdId, billId, {
            amountPaise,
            idempotencyKey,
            actingUser: req.user
        });

        res.status(payment.isIdempotentReplay ? 200 : 201).json({ payment });
    } catch (err) {
        next(err);
    }
}

async function getBillPayments(req, res, next) {
    try {
        const { householdId } = req.user;
        const billId = parseInt(req.params.id, 10);

        if (isNaN(billId)) {
            return res.status(400).json({ error: { message: 'Invalid bill ID', status: 400 } });
        }

        const payments = await billingService.getBillPayments(householdId, billId, req.user);
        res.status(200).json({ payments });
    } catch (err) {
        next(err);
    }
}

async function revokePayment(req, res, next) {
    try {
        const { householdId } = req.user;
        const paymentId = parseInt(req.params.paymentId, 10);
        const { reason } = req.body || {};

        if (isNaN(paymentId)) {
            return res.status(400).json({ error: { message: 'Invalid payment ID', status: 400 } });
        }

        const payment = await billingService.revokePayment(householdId, paymentId, {
            actingUser: req.user,
            reason
        });

        res.status(200).json({ payment });
    } catch (err) {
        next(err);
    }
}

async function updatePaidAmount(req, res, next) {
    try {
        const { householdId } = req.user;
        const billId = parseInt(req.params.id, 10);
        const { paidAmountPaise, reason } = req.body;

        if (isNaN(billId)) {
            return res.status(400).json({ error: { message: 'Invalid bill ID', status: 400 } });
        }

        const bill = await billingService.updateBillPaidAmount(householdId, billId, {
            paidAmountPaise,
            reason,
            actingUser: req.user
        });

        res.status(200).json({ bill });
    } catch (err) {
        next(err);
    }
}

async function finalizeBill(req, res, next) {
    try {
        const { householdId } = req.user;
        const billId = parseInt(req.params.id, 10);

        if (isNaN(billId)) {
            return res.status(400).json({ error: { message: 'Invalid bill ID', status: 400 } });
        }

        const bill = await billingService.finalizeBill(householdId, billId, req.user);
        res.status(200).json({ bill });
    } catch (err) {
        next(err);
    }
}

async function reopenBill(req, res, next) {
    try {
        const { householdId } = req.user;
        const billId = parseInt(req.params.id, 10);
        const { reason } = req.body;

        if (isNaN(billId)) {
            return res.status(400).json({ error: { message: 'Invalid bill ID', status: 400 } });
        }

        const bill = await billingService.reopenBill(householdId, billId, reason, req.user);
        res.status(200).json({ bill });
    } catch (err) {
        next(err);
    }
}

async function getMemberCycles(req, res, next) {
    try {
        const { householdId } = req.user;
        const members = await billingService.getMemberCycleSummary(householdId, req.user);
        res.status(200).json({ members });
    } catch (err) {
        next(err);
    }
}

async function updateMemberMessStartDate(req, res, next) {
    try {
        const { householdId } = req.user;
        const { userId } = req.params;
        const { messStartDate } = req.body;

        const updated = await billingService.updateMemberMessStartDate(
            householdId,
            userId,
            messStartDate,
            req.user
        );

        res.status(200).json({ membership: updated });
    } catch (err) {
        next(err);
    }
}

async function getAutomationStatus(req, res, next) {
    try {
        const { householdId } = req.user;
        const automationStatus = await billingService.getLatestAutomationStatus(householdId);
        res.status(200).json({ automationStatus });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    generateMonthlyBills,
    getBills,
    getBillById,
    recordPayment,
    revokePayment,
    updatePaidAmount,
    getBillPayments,
    finalizeBill,
    reopenBill,
    getMemberCycles,
    updateMemberMessStartDate,
    getAutomationStatus
};

