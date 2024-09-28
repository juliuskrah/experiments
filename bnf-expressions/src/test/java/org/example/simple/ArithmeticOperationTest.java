package org.example.simple;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class ArithmeticOperationTest {
    private static final int PARAM_A = 20;
    private static final int PARAM_B = 5;
    private static final int PARAM_C = 2;
    private static ArithmeticOperation operation;

    @BeforeAll
    static void setup() {
        operation = new SimpleArithmeticOperation();
    }

    @Test
    void testAdd() {
        int result = operation.add(PARAM_A, PARAM_B, PARAM_C);
        var expected = 27;
        assertEquals(expected, result);
    }

    @Test
    void testSubtract() {
        int result = operation.subtract(PARAM_A, PARAM_B, PARAM_C);
        var expected = 13;
        assertEquals(expected, result);
    }

    @Test
    void testMultiply() {
        long result = operation.multiply(PARAM_A, PARAM_B, PARAM_C);
        var expected = 200l;
        assertEquals(expected, result);
    }

    @Test
    void testDivide() {
        float result = operation.divide(PARAM_A, PARAM_B, PARAM_C);
        var expected = 2.0f;
        assertEquals(expected, result);
    }
}
