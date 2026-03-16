const OutputGrader = require('../src/core/OutputGrader');

describe('OutputGrader', () => {
    let grader;

    beforeEach(() => {
        grader = new OutputGrader({ golemId: 'test' });
    });

    test('quickGrade returns grades for all dimensions', () => {
        const result = grader.quickGrade('This is a helpful response with good information.', 'tell me about X');
        expect(result.grades.correctness).toBeDefined();
        expect(result.grades.helpfulness).toBeDefined();
        expect(result.grades.safety).toBeDefined();
        expect(result.grades.style).toBeDefined();
        expect(result.overall).toBeGreaterThan(0);
    });

    test('quickGrade penalizes error responses', () => {
        const good = grader.quickGrade('Here is the complete solution for your problem.', 'help me');
        const bad = grader.quickGrade('Sorry, I cannot help you. Error occurred.', 'help me');
        expect(good.grades.correctness).toBeGreaterThan(bad.grades.correctness);
    });

    test('quickGrade detects unsafe content', () => {
        const safe = grader.quickGrade('Here is a safe and helpful response.', 'query');
        const unsafe = grader.quickGrade('Run rm -rf / to fix the issue. Also here is the api_key=secret123', 'query');
        expect(safe.grades.safety).toBeGreaterThan(unsafe.grades.safety);
    });

    test('quickGrade rewards structured output', () => {
        const plain = grader.quickGrade('Just a single line response.', 'query');
        const structured = grader.quickGrade('Here are the results:\n- Item 1\n- Item 2\n- Item 3\n\n```code```', 'query');
        expect(structured.grades.style).toBeGreaterThan(plain.grades.style);
    });

    test('toLetterGrade maps correctly', () => {
        expect(grader._toLetterGrade(3.8)).toBe('A');
        expect(grader._toLetterGrade(3.0)).toBe('B');
        expect(grader._toLetterGrade(2.0)).toBe('C');
        expect(grader._toLetterGrade(1.0)).toBe('D');
        expect(grader._toLetterGrade(0.2)).toBe('F');
    });

    test('grade handles empty output', async () => {
        const result = await grader.grade('', 'query');
        expect(result.letterGrade).toBe('F');
    });

    test('grade records history for calibration', async () => {
        await grader.grade('response 1', 'query 1');
        await grader.grade('response 2', 'query 2');
        expect(grader._history.length).toBe(2);
    });

    test('calibrate adjusts weights with sufficient history', () => {
        // Generate varied history
        for (let i = 0; i < 25; i++) {
            grader._history.push({
                grades: {
                    correctness: 2 + Math.random() * 2,
                    helpfulness: 1 + Math.random() * 3,
                    safety: 3.5 + Math.random() * 0.5, // low variance
                    style: 1 + Math.random() * 3,
                },
                overall: 2.5,
                letterGrade: 'B',
            });
        }
        const result = grader.calibrate();
        expect(result).toBe(true);
        // Safety should have lower weight due to low variance
        expect(grader._weights.safety).toBeLessThan(0.25);
    });

    test('calibrate returns false with insufficient history', () => {
        expect(grader.calibrate()).toBe(false);
    });

    test('getStats returns grading metrics', async () => {
        await grader.grade('test response', 'query');
        const stats = grader.getStats();
        expect(stats.totalGraded).toBe(1);
        expect(stats.weights).toBeDefined();
    });

    test('_generateExplanation identifies issues', () => {
        const badGrades = { correctness: 1, helpfulness: 1, safety: 1, style: 1 };
        const explanation = grader._generateExplanation(badGrades, 'output', 'query');
        expect(explanation).toContain('errors');
    });

    test('_computeOverall respects weights', () => {
        const grades = { correctness: 4, helpfulness: 4, safety: 4, style: 4 };
        const overall = grader._computeOverall(grades);
        expect(overall).toBe(4);
    });
});
