package org.example.bnf.compiletime;

interface ArithmeticOperation {
    @Operation(expression = ":a + :b + :c")
    int add(int a, int b, int c);

    @Operation(expression = ":a - :b - :c")
    short subtract(int a, int b, int c);

    @Operation(expression = ":a * :b * :c")
    long multiply(int a, int b, int c);

    @Operation(expression = ":a / :b / :c")
    float divide(int a, int b, int c);
}
