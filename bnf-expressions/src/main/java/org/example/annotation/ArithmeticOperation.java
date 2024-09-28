package org.example.annotation;

import org.example.annotation.Operation.OperationType;

interface ArithmeticOperation {

    @Operation(OperationType.ADD)
    int add(int a, int b, int c);

    @Operation(OperationType.SUBTRACT)
    short subtract(int a, int b, int c);

    @Operation(OperationType.MULTIPLY)
    long multiply(int a, int b, int c);

    @Operation(OperationType.DIVIDE)
    float divide(int a, int b, int c);
}
