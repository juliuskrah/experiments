package org.example.simple;

class SimpleArithmeticOperation implements ArithmeticOperation {

    @Override
    public int add(int a, int b, int c) {
        return a + b + c;
    }

    @Override
    public short subtract(int a, int b, int c) {
        return (short) (a - b - c);
    }

    @Override
    public long multiply(int a, int b, int c) {
        return a * b * c;
    }

    @Override
    public float divide(int a, int b, int c) {
        return (float) a / b / c;
    }
    
}
