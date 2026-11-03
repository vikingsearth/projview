using System;

namespace Demo
{
    // tabs-free, 4-space C# - indent guides every 4 columns
    public class Greeter
    {
        private readonly string _name;

        public Greeter(string name) => _name = name;

        public string Greet()
        {
            if (string.IsNullOrWhiteSpace(_name))
            {
                return "hello, stranger";
            }
            return $"hello, {_name}";
        }
    }
}
